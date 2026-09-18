import { describe, it, expect } from 'vitest';
import { compileDistributionSql, MIN_BINS, MAX_BINS } from '../shared/semanticCompile.js';
import { styleById, compileViewblock } from '../shared/viewStyles.js';
import { buildChartOption } from '../shared/chartOption.js';
import { validateReportPlan } from '../shared/reportPlan.js';
import { parseAttrs } from '../shared/parser.js';

// O catálogo respondia UMA coisa: uma linha agregada por categoria. "Onde os
// valores se concentram" não cabe nessa forma — conta OBSERVAÇÕES, o que exige
// as linhas do fato antes do group by. Este é o segundo caminho de compilação.
const CAT = {
  model: 'comissoes',
  fact: 'comissoes',
  dimensions: {
    unidade: { column: 'unidade' },
    forma_pagamento: { column: 'forma_pagamento' },
    tempo: { column: 'data', hierarchy: ['ano', 'mes'] },
  },
  metrics: {
    faturamento: { column: 'valor', agg: 'sum', label: 'Faturamento', fmt: 'brl' },
    atendimentos: { column: 'atendimento_id', agg: 'count_distinct' },
    cartao: { column: 'valor', agg: 'sum', filters: [{ dim: 'forma_pagamento', values: ['cartao'] }] },
    ticket_medio: { derived: 'faturamento / atendimentos' },
  },
};
const sql = (over = {}) =>
  compileDistributionSql({
    catalog: CAT,
    hash: 'abc123',
    metric: 'faturamento',
    bins: 24,
    factColumns: ['valor', 'unidade', 'ano'],
    ...over,
  });

describe('compileDistributionSql — a segunda forma de resposta', () => {
  it('conta observações por faixa, não métrica por categoria', () => {
    const s = sql();
    expect(s).toContain('count(*) as n');
    expect(s).toContain('coalesce(c.n, 0) as observacoes');
    expect(s).not.toContain('group by 1, 2'); // não é tabela de contingência
  });

  it('as bordas saem DENTRO da query — o compilador continua puro', () => {
    expect(sql()).toContain('select min(v) as lo, quantile_cont(v, 0.99) as hi');
  });

  it('mesma entrada ⇒ SQL byte-idêntico', () => {
    expect(sql()).toBe(sql());
    expect(sql({ bins: 24 })).not.toBe(sql({ bins: 25 }));
  });

  it('faixa vazia APARECE — sem isso o histograma mente por omissão', () => {
    const s = sql();
    expect(s).toContain('unnest(range(0, 24))');
    expect(s).toContain('left join contagem c on c.i = f.i');
    expect(s).toContain('coalesce(c.n, 0)');
  });

  it('ordena por índice de faixa, nunca pela contagem', () => {
    expect(sql().trimEnd().endsWith('order by f.i')).toBe(true);
  });

  it('aparar a cauda no p99 NÃO é descartar: o excedente vai para a última faixa, aberta', () => {
    const s = sql();
    expect(s).toContain('least(23,'); // o que passa do p99 é clampado, não sumido
    expect(s).toContain("then '+' else '' end as faixa"); // e a faixa se declara aberta
    expect(s).toContain('max(v) as vmax'); // o topo REAL sobrevive para a borda superior
  });

  it('tudo igual (hi = lo) ⇒ uma faixa só, sem divisão por zero', () => {
    const s = sql();
    expect(s).toContain('where lim.n > 0 and (f.i = 0 or lim.hi > lim.lo)');
    expect(s).toContain('case when lim.hi > lim.lo');
  });

  it('nulo fica de fora da contagem', () => {
    expect(sql()).toContain('where "valor" is not null');
  });

  it('filtros do bloco e parâmetros entram na CTE de observações', () => {
    const s = sql({
      filters: [{ dim: 'unidade', values: ['Batel'] }],
      params: [{ name: 'ano', type: 'enum', from: 'tempo.ano', default: '%' }],
    });
    const obs = s.slice(s.indexOf('with obs as ('), s.indexOf('), lim as ('));
    expect(obs).toContain(`"unidade" = 'Batel'`);
    expect(obs).toContain('inputs.ano.value');
  });

  it('o filtro EMBUTIDO da métrica vale (faz parte da definição dela)', () => {
    expect(sql({ metric: 'cartao' })).toContain(`"forma_pagamento" = 'cartao'`);
  });
});

describe('o que o histograma RECUSA, e por quê', () => {
  it('métrica derivada não tem coluna para observar', () => {
    expect(() => sql({ metric: 'ticket_medio' })).toThrow(/derivada e não tem coluna/);
  });

  it('contagem não é medida: count_distinct de uma chave passaria no tipo e mentiria', () => {
    expect(() => sql({ metric: 'atendimentos' })).toThrow(/CONTA ocorrências/);
  });

  it('faixas fora de 5..100 são erro, com o intervalo na mensagem', () => {
    expect(() => sql({ bins: 2 })).toThrow(new RegExp(`${MIN_BINS} e ${MAX_BINS}`));
    expect(() => sql({ bins: 200 })).toThrow();
    expect(() => sql({ bins: 12.5 })).toThrow();
    expect(() => sql({ bins: undefined })).toThrow();
  });
});

describe('contrato do estilo graph.histogram', () => {
  const vb = (over = {}) => ({
    v: 1,
    id: 'vb_h1',
    source: { kind: 'semantic', name: 'comissoes' },
    queries: [{ name: 'vb_h1', sql: null }],
    dims: [],
    metrics: [{ name: 'faturamento', alias: 'faturamento', label: 'Faturamento', fmt: 'brl' }],
    params: [],
    style: 'graph.histogram',
    distribution: { bins: 24 },
    children: [],
    ...over,
  });

  it('1 métrica e NENHUMA dimensão — as faixas já são o eixo', () => {
    const s = styleById('graph.histogram');
    expect(s.requires(vb()).ok).toBe(true);
    expect(s.requires(vb({ dims: [{ dim: 'unidade', alias: 'unidade' }] })).ok).toBe(false);
    expect(s.requires(vb({ metrics: [] })).ok).toBe(false);
  });

  it('compila para barras CONTÍGUAS sobre as faixas', () => {
    const out = compileViewblock(vb(), { vb: vb(), source: { name: 'comissoes', columns: [] }, baseSql: sql() });
    expect(out).toContain(
      '<BarChart data={vb_h1} x=faixa y=observacoes yFmt=num0 contiguous=true xAxisTitle="Faturamento" seriesLabels={["Observações"]}/>'
    );
  });
});

describe('a marca: barras encostadas sinalizam escala contínua', () => {
  const rows = [
    { faixa: '0', observacoes: 3 },
    { faixa: '50', observacoes: 91 },
    { faixa: '100+', observacoes: 12 },
  ];
  const opt = (attrs) =>
    buildChartOption({ kind: 'bar', rows, attrs: { x: 'faixa', y: 'observacoes', ...attrs }, palette: ['#a63d5f'], dark: false });

  it('contiguous fecha o vão e tira o canto arredondado que separa categorias', () => {
    const h = opt({ contiguous: 'true' });
    expect(h.series[0].barCategoryGap).toBe(0);
    expect(h.series[0].itemStyle).toBeUndefined();
    const barras = opt({});
    expect(barras.series[0].barCategoryGap).toBeUndefined();
    expect(barras.series[0].itemStyle).toEqual({ borderRadius: [3, 3, 0, 0] });
  });

  it('o eixo das faixas ganha o nome da medida observada', () => {
    const h = opt({ contiguous: 'true', xAxisTitle: 'Faturamento' });
    expect(h.xAxis.name).toBe('Faturamento');
    expect(h.grid.bottom).toBeGreaterThan(opt({}).grid.bottom);
  });
});

describe('validação do plano', () => {
  const plano = (b) => ({
    version: 1,
    title: 'T',
    visibility: 'public',
    catalog: 'comissoes',
    pages: [
      {
        path: 'a.md',
        title: 'A',
        blocks: [{ metrics: ['faturamento'], dims: [], filters: [], style: 'graph.histogram', distribution: { bins: 24 }, ...b }],
      },
    ],
  });
  const val = (b) => validateReportPlan(plano(b), { catalog: CAT, factColumns: ['valor'] });

  it('plano bom passa', () => {
    expect(val()).toEqual([]);
  });

  it('o erro da métrica-ponteiro aparece no PLANO, não só no build', () => {
    expect(val({ metrics: ['ticket_medio'] })[0].message).toMatch(/derivada/);
    expect(val({ metrics: ['atendimentos'] })[0].message).toMatch(/conta ocorrências/i);
  });

  it('bins ausente ou fora do intervalo é erro com caminho', () => {
    const e = val({ distribution: undefined })[0];
    expect(e.path).toMatch(/distribution\.bins$/);
    expect(val({ distribution: { bins: 3 } })).toHaveLength(1);
  });
});

// A tag tem de significar a MESMA coisa nos três ambientes. O editor e o app
// publicado compartilham buildChartOption, mas cada um chega nos atributos por
// um caminho — e esta tag mistura valor cru (contiguous=true) com valor citado
// (xAxisTitle="Faturamento"), que é onde um parser diverge do outro em silêncio.
describe('a tag atravessa o parser do runtime publicado', () => {
  it('atributo cru e atributo citado chegam iguais', () => {
    const tag = '<BarChart data={vb_h1} x=faixa y=observacoes yFmt=num0 contiguous=true xAxisTitle="Faturamento" seriesLabels={["Observações"]}/>';
    const a = parseAttrs(tag.replace(/^<BarChart\s+/, '').replace(/\/>$/, ''));
    expect(a.x).toBe('faixa');
    expect(a.y).toBe('observacoes');
    expect(a.contiguous).toBe('true');
    expect(a.xAxisTitle).toBe('Faturamento');
    const o = buildChartOption({
      kind: 'bar',
      rows: [{ faixa: '41', observacoes: 81 }],
      attrs: a,
      palette: ['#a63d5f'],
      dark: false,
    });
    expect(o.series[0].barCategoryGap).toBe(0);
    expect(o.xAxis.name).toBe('Faturamento');
  });
});
