// Opções de bloco que valem em qualquer relatório: `order`, `table` e
// `reference`. As três são opcionais e, omitidas, não mudam um byte da saída.
//
// Este arquivo existe versionado de propósito: as mesmas garantias nos módulos
// de origem (semanticCompile/reportPlan) moram em arquivos que o .gitignore
// exclui por dependerem de um projeto interno como fixture. Aqui a fixture é
// inline, então a cobertura acompanha o repositório.
import { describe, it, expect } from 'vitest';
import { compileCatalogSql, compileDistributionSql } from '../shared/semanticCompile.js';
import { validateReportPlan } from '../shared/reportPlan.js';
import { compileViewblock, ORIENTATION_STYLES, TABLE_STYLES, ORDER_IGNORED_STYLES, REFERENCE_STYLES, REFERENCE_FROM_STYLES } from '../shared/viewStyles.js';

// Fonte para os testes de compilação de estilo (o compilador só lê as colunas).
const SRC = {
  name: 'f',
  columns: [
    { name: 'natureza', type: 'VARCHAR' },
    { name: 'faixa', type: 'VARCHAR' },
    { name: 'regiao', type: 'VARCHAR' },
    { name: 'sedes', type: 'BIGINT' },
    { name: 'artigos', type: 'BIGINT' },
  ],
};

const CAT = {
  model: 'vendas',
  fact: 'f',
  dimensions: {
    unidade: { column: 'unidade', label: 'Unidade' },
    tempo: { column: 'dt', hierarchy: ['ano'] },
  },
  metrics: {
    total: { agg: 'sum', column: 'v', label: 'Total' },
    itens: { agg: 'count_distinct', column: 'id' },
    // constante por unidade: existe para ser lida, não somada
    meta: { agg: 'max', column: 'meta', semi_additive: { over: 'unidade', take: 'avg' } },
  },
};
const COLS = ['unidade', 'dt', 'v', 'id', 'meta'];
const sql = (over = {}) => compileCatalogSql({ catalog: CAT, factColumns: COLS, metrics: ['total'], dims: [{ dim: 'unidade' }], ...over });

const PLANO = {
  version: 1,
  title: 'T',
  visibility: 'public',
  catalog: 'vendas',
  pages: [{ path: 'a.md', title: 'A', blocks: [{ id: 'b0', metrics: ['total'], dims: [{ dim: 'unidade' }], style: 'tabular' }] }],
};
const plano = (bloco) => {
  const p = JSON.parse(JSON.stringify(PLANO));
  p.pages[0].blocks[0] = { id: 'b0', metrics: ['total'], dims: [{ dim: 'unidade' }], ...bloco };
  return p;
};
const erros = (bloco) => validateReportPlan(plano(bloco), { catalog: CAT, factColumns: COLS });

describe('order — ordenação declarada pelo bloco', () => {
  it('sem order, o padrão continua sendo a 1ª métrica desc', () => {
    expect(sql()).toContain('order by "total" desc');
  });

  it('ordena por métrica ou por dimensão, na direção pedida', () => {
    expect(sql({ order: [{ by: 'total', dir: 'asc' }] })).toContain('order by "total" asc');
    expect(sql({ order: [{ by: 'unidade' }] })).toContain('order by "unidade" asc');
    expect(sql({ order: [{ by: 'unidade', dir: 'desc' }, { by: 'total', dir: 'asc' }] })).toContain('order by "unidade" desc, "total" asc');
  });

  it('ordenar pelo que não está na seleção é erro, não SQL inválido em runtime', () => {
    expect(() => sql({ order: [{ by: 'itens' }] })).toThrow(/não está na seleção/);
    expect(erros({ style: 'tabular', order: [{ by: 'itens' }] }).some((e) => e.path === 'pages[0].blocks[0].order[0].by')).toBe(true);
    expect(erros({ style: 'tabular', order: [{ by: 'total', dir: 'crescente' }] }).some((e) => e.path === 'pages[0].blocks[0].order[0].dir')).toBe(true);
  });

  it('estilos que mandam na própria ordem recusam a chave em vez de ignorá-la', () => {
    for (const style of ORDER_IGNORED_STYLES) {
      const e = erros({ style, order: [{ by: 'total' }], dims: [{ dim: 'tempo', level: 'ano' }], pivot: undefined });
      expect(e.some((x) => x.path === 'pages[0].blocks[0].order' && /ignoraria/.test(x.message))).toBe(true);
    }
  });
});

describe('table — busca e paginação', () => {
  it('aceita só search e rows, e só onde existe tabela', () => {
    // `group` pede ≥2 dimensões pelo contrato do próprio estilo
    const dimsDe = (style) => (style === 'group' ? [{ dim: 'unidade' }, { dim: 'tempo', level: 'ano' }] : [{ dim: 'unidade' }]);
    for (const style of TABLE_STYLES) expect(erros({ style, dims: dimsDe(style), table: { search: true, rows: 25 } })).toEqual([]);
    expect(erros({ style: 'graph.bar', table: { search: true } }).some((e) => /não desenha uma/.test(e.message))).toBe(true);
    expect(erros({ style: 'tabular', table: { busca: true } }).some((e) => e.path === 'pages[0].blocks[0].table.busca')).toBe(true);
    expect(erros({ style: 'tabular', table: { rows: 0 } }).some((e) => e.path === 'pages[0].blocks[0].table.rows')).toBe(true);
  });
});

describe('reference — linha de corte', () => {
  it('exige exatamente uma origem do valor', () => {
    expect(erros({ style: 'graph.bar', reference: [{ axis: 'y', value: 0 }] })).toEqual([]);
    expect(erros({ style: 'graph.bar', reference: [{ value: 0, from: 'total' }] }).some((e) => /exatamente um/.test(e.message))).toBe(true);
    expect(erros({ style: 'graph.bar', reference: [{ axis: 'y' }] }).some((e) => /exatamente um/.test(e.message))).toBe(true);
  });

  it('`from` nomeia métrica DO BLOCO e só vale onde a série é filtrável', () => {
    expect(erros({ style: 'graph.bar', reference: [{ from: 'total' }] })).toEqual([]);
    expect(erros({ style: 'graph.bar', reference: [{ from: 'itens' }] }).some((e) => /não é métrica deste bloco/.test(e.message))).toBe(true);
    for (const style of REFERENCE_STYLES.filter((s) => !REFERENCE_FROM_STYLES.includes(s)))
      expect(
        erros({ style, metrics: ['total', 'itens', 'meta'], reference: [{ from: 'total' }] }).some((e) => /use value \(literal\)/.test(e.message))
      ).toBe(true);
  });

  it('não vale onde não há gráfico', () => {
    expect(erros({ style: 'tabular', reference: [{ value: 1 }] }).some((e) => /não desenha linha de referência/.test(e.message))).toBe(true);
  });
});

describe('semi_additive — a dimensão fixada por filtro não é colapso', () => {
  it('sem a dimensão, erro; com ela na seleção OU fixada num valor, compila', () => {
    const m = { metrics: ['meta'], dims: [] };
    expect(() => compileCatalogSql({ catalog: CAT, factColumns: COLS, ...m })).toThrow(/semi-aditiva/);
    expect(compileCatalogSql({ catalog: CAT, factColumns: COLS, metrics: ['meta'], dims: [{ dim: 'unidade' }] })).toContain('max("meta")');
    // é o caso da página parametrizada: a rota já fixa a dimensão num valor
    expect(
      compileCatalogSql({ catalog: CAT, factColumns: COLS, ...m, filters: [{ dim: 'unidade', values: ['Centro'] }] })
    ).toContain('max("meta")');
    // com vários valores a soma volta a atravessar a dimensão
    expect(() =>
      compileCatalogSql({ catalog: CAT, factColumns: COLS, ...m, filters: [{ dim: 'unidade', values: ['Centro', 'Norte'] }] })
    ).toThrow(/semi-aditiva/);
  });
});

// ---------------------------------------------------------------------------
// `group`: o cruzamento de 2 dimensões deixa de ser tabela e vira pilha.
// ---------------------------------------------------------------------------
describe('group: barra empilhada no cruzamento simples', () => {
  const vb = (over = {}) => ({
    v: 1,
    id: 'vb_g',
    source: { kind: 'source', name: 'f' },
    dims: [
      { table: 'f', column: 'natureza', alias: 'natureza' },
      { table: 'f', column: 'faixa', alias: 'faixa' },
    ],
    metrics: [{ column: 'sedes', agg: 'sum', alias: 'sedes', fmt: 'num0' }],
    filters: [],
    style: 'group',
    ...over,
  });

  it('2 dimensões e 1 métrica: eixo, série e altura, com o fmt da métrica', () => {
    const out = compileViewblock(vb(), SRC);
    expect(out).toContain('<BarChart data={vb_g} x=natureza y=sedes series=faixa type=stacked yFmt=num0/>');
    expect(out).not.toContain('<DataTable');
  });

  it('stack: percent normaliza a coluna e larga o fmt da métrica (o eixo vira %)', () => {
    const out = compileViewblock(vb({ stack: 'percent' }), SRC);
    expect(out).toContain('type=stacked100');
    expect(out).not.toContain('yFmt=');
  });

  it('3 dimensões continuam tabela — nenhuma barra carrega a seleção', () => {
    const out = compileViewblock(vb({ dims: [...vb().dims, { table: 'f', column: 'regiao', alias: 'regiao' }] }), SRC);
    expect(out).toContain('<DataTable');
    expect(out).not.toContain('<BarChart');
  });

  it('2 métricas continuam tabela', () => {
    const out = compileViewblock(
      vb({ metrics: [...vb().metrics, { column: 'artigos', agg: 'sum', alias: 'artigos', fmt: 'num0' }] }),
      SRC
    );
    expect(out).toContain('<DataTable');
    expect(out).not.toContain('<BarChart');
  });
});

// ---------------------------------------------------------------------------
// `orientation`: a marca deitada. O motor já sabia (swapXY); nenhum estilo
// emitia, então nenhum relatório conseguia produzir uma barra horizontal.
// ---------------------------------------------------------------------------
describe('orientation: barra e histograma deitados', () => {
  const barra = (over = {}) => ({
    v: 1,
    id: 'vb_o',
    source: { kind: 'source', name: 'f' },
    dims: [{ table: 'f', column: 'natureza', alias: 'natureza' }],
    metrics: [{ column: 'sedes', agg: 'sum', alias: 'sedes', fmt: 'num0' }],
    filters: [],
    style: 'graph.bar',
    ...over,
  });

  it('vertical é o padrão e não muda um byte', () => {
    expect(compileViewblock(barra(), SRC)).not.toContain('swapXY');
    expect(compileViewblock(barra({ orientation: 'vertical' }), SRC)).not.toContain('swapXY');
  });

  it('horizontal emite swapXY na barra', () => {
    expect(compileViewblock(barra({ orientation: 'horizontal' }), SRC)).toContain('swapXY=true');
  });

  it('o histograma deitado mantém contiguous e o título do eixo', () => {
    const vb = {
      v: 1,
      id: 'vb_h',
      source: { kind: 'source', name: 'f' },
      dims: [],
      metrics: [{ column: 'sedes', agg: 'avg', alias: 'sedes', label: 'Sedes' }],
      filters: [],
      style: 'graph.histogram',
      distribution: { bins: 24 },
      orientation: 'horizontal',
    };
    const out = compileViewblock(vb, SRC);
    expect(out).toContain('contiguous=true');
    expect(out).toContain('xAxisTitle="Sedes"');
    expect(out).toContain('swapXY=true');
  });

  it('ORIENTATION_STYLES é fechado: linha, bolha e intervalo ficam de fora', () => {
    expect(ORIENTATION_STYLES).toEqual(['graph.bar', 'graph.histogram']);
    for (const e of ['graph.line', 'graph.bubble', 'graph.range', 'tabular', 'group']) {
      expect(ORIENTATION_STYLES).not.toContain(e);
    }
  });
});

// O rótulo da faixa é TEXTO montado no SQL: não passa por formatNumber, então o
// separador decimal precisa sair certo de lá.
describe('histograma: rótulo de faixa em pt-BR', () => {
  it('a faixa fracionária usa vírgula', () => {
    const sql = compileDistributionSql({ catalog: CAT, factColumns: COLS, metric: 'total', bins: 12, filters: [], params: [] });
    expect(String(sql)).toContain("replace(cast(round(ini, 2) as varchar), '.', ',')");
  });
});
