import { describe, it, expect } from 'vitest';
import { parseDerived } from '../shared/semanticCatalog.js';
import { compileCatalogSql, isRankMetric } from '../shared/semanticCompile.js';
import { styleById, compileViewblock } from '../shared/viewStyles.js';
import { buildChartOption } from '../shared/chartOption.js';
import { validateReportPlan } from '../shared/reportPlan.js';

// "Quem subiu e quem caiu" não era um buraco de vocabulário do catálogo: é o
// SQL que proíbe `lag(rank(...) over (...)) over (...)` — "window function
// calls cannot be nested". Por isso a posição precisa virar COLUNA num estágio
// antes de a segunda janela poder lê-la.
const CAT = {
  model: 'comissoes',
  fact: 'comissoes',
  dimensions: {
    unidade: { column: 'unidade' },
    regiao: { column: 'regiao' },
    tempo: { column: 'data', hierarchy: ['ano', 'mes'] },
  },
  metrics: {
    faturamento: { column: 'valor', agg: 'sum', label: 'Faturamento' },
    posicao_unidade: { derived: 'posicao(faturamento, ano)', label: 'Posição' },
    subiu_caiu: { derived: 'variacao_posicao(faturamento, ano)', label: 'Posições ganhas' },
    margem: { derived: 'faturamento / 2' },
  },
};
const DIMS = [{ dim: 'tempo', level: 'ano' }, { dim: 'unidade' }];
const sql = (over = {}) =>
  compileCatalogSql({ catalog: CAT, hash: 'abc123', metrics: ['posicao_unidade'], dims: DIMS, factColumns: ['valor', 'unidade'], ...over });

describe('gramática: posicao e variacao_posicao', () => {
  const base = new Set(['faturamento']);

  it('reconhece os dois construtores com o nível', () => {
    expect(parseDerived('posicao(faturamento, ano)', base).tokens).toEqual([
      { type: 'posicao', name: 'faturamento', level: 'ano' },
    ]);
    expect(parseDerived('variacao_posicao(faturamento, ano)', base).tokens).toEqual([
      { type: 'variacao_posicao', name: 'faturamento', level: 'ano' },
    ]);
  });

  it('métrica desconhecida é recusada, como nos outros construtores', () => {
    expect(parseDerived('posicao(inexistente, ano)', base).ok).toBe(false);
  });

  it('isRankMetric distingue posição de qualquer outra derivada', () => {
    expect(isRankMetric(CAT, 'posicao_unidade')).toBe(true);
    expect(isRankMetric(CAT, 'subiu_caiu')).toBe(true);
    expect(isRankMetric(CAT, 'margem')).toBe(false);
    expect(isRankMetric(CAT, 'faturamento')).toBe(false);
  });
});

describe('o estágio que contorna a proibição do SQL', () => {
  it('a posição vira COLUNA numa CTE — nunca janela dentro de janela', () => {
    const s = sql({ metrics: ['subiu_caiu'] });
    expect(s).toContain(', posicoes as (');
    expect(s).toContain('rank() over (partition by "ano" order by "faturamento" desc) as "__pos_faturamento_ano"');
    expect(s).toContain('from posicoes');
    expect(s).not.toMatch(/lag\(\s*rank\(/); // o que o banco recusaria
  });

  it('sem métrica de posição o SQL não ganha estágio nenhum (nada muda p/ quem já existia)', () => {
    const s = sql({ metrics: ['faturamento'] });
    expect(s).not.toContain('posicoes');
    expect(s).toContain('from base');
  });

  it('a variação é ANTERIOR − ATUAL: positivo = subiu', () => {
    const s = sql({ metrics: ['subiu_caiu'] });
    expect(s).toContain('lag("__pos_faturamento_ano", 1) over (partition by "unidade" order by "ano") - "__pos_faturamento_ano"');
  });

  it('duas métricas sobre a mesma posição compartilham UMA coluna', () => {
    const s = sql({ metrics: ['posicao_unidade', 'subiu_caiu'] });
    expect(s.match(/rank\(\) over/g)).toHaveLength(1);
  });

  it('posição exige o nível na seleção — senão não há "dentro de cada período"', () => {
    expect(() => sql({ dims: [{ dim: 'unidade' }] })).toThrow(/exige o nível ano/);
  });

  it('mesma entrada ⇒ SQL byte-idêntico', () => {
    expect(sql()).toBe(sql());
  });
});

describe('corte do topo: quem esteve no top N em ALGUM período', () => {
  it('recorta pela entidade, não pelo período — a trajetória inteira sobrevive', () => {
    const s = sql({ rankTop: 5 });
    expect(s).toContain('where ("unidade") in (select "unidade" from posicoes where "__pos_faturamento_ano" <= 5)');
  });

  it('sem entidade além do tempo não há o que rankear', () => {
    expect(() => sql({ dims: [{ dim: 'tempo', level: 'ano' }], rankTop: 5 })).toThrow(/além do nível temporal/);
  });

  it('rankTop sem métrica de posição é ignorado (não inventa filtro)', () => {
    expect(sql({ metrics: ['faturamento'], rankTop: 5 })).not.toContain('where (');
  });
});

describe('contrato do estilo graph.bump', () => {
  const SOURCE = { name: 'comissoes', columns: [{ name: 'ano', type: 'BIGINT' }, { name: 'unidade', type: 'VARCHAR' }] };
  const vb = (over = {}) => ({
    v: 1,
    id: 'vb_b1',
    source: { kind: 'semantic', name: 'comissoes' },
    queries: [{ name: 'vb_b1', sql: null }],
    dims: [
      { dim: 'tempo', level: 'ano', alias: 'ano', column: 'ano' },
      { dim: 'unidade', alias: 'unidade', column: 'unidade' },
    ],
    metrics: [{ name: 'posicao_unidade', alias: 'posicao_unidade', label: 'Posição' }],
    params: [],
    style: 'graph.bump',
    children: [],
    ...over,
  });

  it('2 dimensões, uma TEMPORAL, e 1 métrica', () => {
    const s = styleById('graph.bump');
    expect(s.requires(vb(), SOURCE).ok).toBe(true);
    expect(s.requires(vb({ dims: [vb().dims[1]] }), SOURCE).ok).toBe(false);
    expect(s.requires(vb({ dims: [vb().dims[1], { dim: 'regiao', alias: 'regiao', column: 'regiao' }] }), SOURCE).ok).toBe(false);
    expect(s.requires(vb({ metrics: [] }), SOURCE).ok).toBe(false);
  });

  it('tempo no eixo, entidade em séries, eixo de posição invertido', () => {
    const out = compileViewblock(vb(), { vb: vb(), source: SOURCE, baseSql: 'select 1' });
    expect(out).toContain('<LineChart data={vb_b1} x=ano y=posicao_unidade series=unidade yInverted=true yAxisTitle="Posição"/>');
  });

  it('reordena CRONOLOGICAMENTE — o SQL da fonte ordena por posição', () => {
    const out = compileViewblock(vb(), { vb: vb(), source: SOURCE, baseSql: 'select 1' });
    expect(out).toContain('order by "ano"');
  });
});

describe('a marca: eixo de posição', () => {
  const rows = [
    { ano: 2024, unidade: 'A', pos: 1 },
    { ano: 2025, unidade: 'A', pos: 3 },
    { ano: 2024, unidade: 'B', pos: 2 },
  ];
  const opt = (attrs) =>
    buildChartOption({ kind: 'line', rows, attrs: { x: 'ano', y: 'pos', series: 'unidade', ...attrs }, palette: ['#a63d5f', '#333'], dark: false });

  it('1º lugar no TOPO, piso em 1 e passo inteiro — não existe "lugar 2,5"', () => {
    const o = opt({ yInverted: 'true' });
    expect(o.yAxis.inverse).toBe(true);
    expect(o.yAxis.min).toBe(1);
    expect(o.yAxis.max).toBe(3);
    expect(o.yAxis.interval).toBe(1);
  });

  it('período sem dado INTERROMPE a linha — zero seria "caiu para a posição 0"', () => {
    const o = opt({ yInverted: 'true' });
    const b = o.series.find((s) => s.name === 'B');
    expect(b.data).toEqual([2, null]);
    expect(b.connectNulls).toBe(false);
    const semRank = opt({});
    expect(semRank.series.find((s) => s.name === 'B').data).toEqual([2, 0]);
  });

  it('sem suavização: curva inventaria posições entre os períodos', () => {
    expect(opt({ yInverted: 'true' }).series[0].smooth).toBe(false);
    expect(opt({}).series[0].smooth).toBe(true);
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
        blocks: [{ metrics: ['posicao_unidade'], dims: DIMS, filters: [], style: 'graph.bump', bump: { top: 5 }, ...b }],
      },
    ],
  });
  const val = (b) => validateReportPlan(plano(b), { catalog: CAT, factColumns: ['ano', 'unidade'] });

  it('plano bom passa', () => {
    expect(val()).toEqual([]);
  });

  it('métrica que não é posição é recusada com o caminho e o conserto', () => {
    const e = val({ metrics: ['faturamento'] });
    expect(e[0].path).toMatch(/metrics\[0\]$/);
    expect(e[0].message).toMatch(/posicao\(<métrica>, <nível>\)/);
  });

  it('top inválido é erro', () => {
    expect(val({ bump: { top: 1 } })).toHaveLength(1);
    expect(val({ bump: undefined })).toEqual([]); // opcional
  });
});
