import { describe, it, expect } from 'vitest';
import { AGGS, DISTRIBUTION_AGGS, validateCatalog } from '../shared/semanticCatalog.js';
import { compileCatalogSql } from '../shared/semanticCompile.js';

// O catálogo só sabia colapsar o grupo num número central ou extremo
// (sum/avg/min/max/count/count_distinct). Toda média publicada saía nua — sem
// dizer se o grupo é homogêneo ou se a média é a mentira aritmética entre dois
// mundos. Estas agregações descrevem a FORMA do grupo.
const CAT = {
  model: 'vendas',
  fact: 'vendas',
  dimensions: { unidade: { column: unidadeCol() } },
  metrics: {
    ticket_medio: { agg: 'avg', column: 'valor', label: 'Ticket médio' },
    ticket_p25: { agg: 'p25', column: 'valor', label: 'P25' },
    ticket_mediana: { agg: 'median', column: 'valor', label: 'Mediana' },
    ticket_p75: { agg: 'p75', column: 'valor', label: 'P75' },
    ticket_p90: { agg: 'p90', column: 'valor', label: 'P90' },
    ticket_desvio: { agg: 'stddev', column: 'valor', label: 'Desvio' },
  },
};
function unidadeCol() {
  return 'unidade';
}
const sql = (metrics) =>
  compileCatalogSql({ catalog: CAT, hash: 'dev', metrics, dims: [{ dim: 'unidade' }], factColumns: ['unidade', 'valor'] });

describe('o catálogo aprendeu a descrever dispersão', () => {
  it('as novas agregações são aceitas pelo validador', () => {
    for (const a of ['median', 'p25', 'p75', 'p90', 'stddev']) expect(AGGS.has(a)).toBe(true);
    expect(validateCatalog(CAT, ['unidade', 'valor'])).toEqual([]);
  });

  it('o conjunto continua FECHADO — o que não está declarado é erro', () => {
    const e = validateCatalog({ ...CAT, metrics: { x: { agg: 'variance', column: 'valor' } } }, ['unidade', 'valor']);
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe('metrics.x.agg');
  });

  it('quantil compila para quantile_cont com a fração certa, não para uma função inventada', () => {
    const s = sql(['ticket_p25', 'ticket_mediana', 'ticket_p75', 'ticket_p90']);
    expect(s).toContain('quantile_cont("valor", 0.25)');
    expect(s).toContain('quantile_cont("valor", 0.5)');
    expect(s).toContain('quantile_cont("valor", 0.75)');
    expect(s).toContain('quantile_cont("valor", 0.9)');
    // o nome da agregação NUNCA vira nome de função
    expect(s).not.toMatch(/\bp25\(|\bmedian\(|\bp90\(/);
  });

  it('desvio compila para stddev_samp (amostral, não populacional)', () => {
    expect(sql(['ticket_desvio'])).toContain('stddev_samp("valor")');
  });

  it('continua determinístico: mesma seleção ⇒ SQL byte-idêntico', () => {
    expect(sql(['ticket_mediana', 'ticket_p75'])).toBe(sql(['ticket_mediana', 'ticket_p75']));
  });

  it('média e mediana convivem no MESMO recorte — é isso que revela a assimetria', () => {
    const s = sql(['ticket_medio', 'ticket_mediana']);
    expect(s).toContain('avg("valor")');
    expect(s).toContain('quantile_cont("valor", 0.5)');
  });
});

describe('guarda de fan-out cobre as novas', () => {
  // Um join one_to_many duplica linhas do fato. Numa soma o erro ao menos
  // aparece inflado; num quantil ele apenas DESLOCA a estatística em direção ao
  // valor repetido — errado e plausível ao mesmo tempo.
  const COM_JOIN = {
    model: 'vendas',
    fact: 'vendas',
    joins: [{ left: 'vendas.id', right: 'itens.venda_id', cardinality: 'one_to_many' }],
    dimensions: { item: { column: 'itens.descricao' } },
    metrics: { mediana: { agg: 'median', column: 'valor' }, distintos: { agg: 'count_distinct', column: 'id' } },
  };
  const compila = (metrics) =>
    compileCatalogSql({ catalog: COM_JOIN, hash: 'dev', metrics, dims: [{ dim: 'item' }], factColumns: ['id', 'valor'] });

  it('mediana sob join one_to_many é ERRO, não resultado silencioso', () => {
    expect(() => compila(['mediana'])).toThrow(/fan-out/);
  });

  it('count_distinct segue sobrevivendo ao mesmo join', () => {
    expect(() => compila(['distintos'])).not.toThrow();
  });

  it('DISTRIBUTION_AGGS e AGGS não divergem', () => {
    for (const a of DISTRIBUTION_AGGS) expect(AGGS.has(a)).toBe(true);
  });
});
