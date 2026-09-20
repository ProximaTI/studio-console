import { describe, it, expect } from 'vitest';
import { buildChartOption, buildRangeOption } from '../shared/chartOption.js';
import { compileViewblock } from '../shared/viewStyles.js';
import { validateReportPlan } from '../shared/reportPlan.js';

// SPEC_narrativa_relatorios §7.3 ensinava a contornar a falta de FAIXA com "um
// bloco extra com filters no período" — duas visões do mesmo dado no lugar de
// uma marca. A linha de referência já existia; a faixa é o que faltava.
//
// Sem chave nova: ARRAY de dois vira faixa, escalar vira linha. `from` já quer
// dizer "ler de uma métrica", então reusá-la como início do intervalo seria
// ambíguo — as mesmas duas chaves cobrem os dois casos.
const rows = [
  { faixa: 'A', n: 10, lo: 2, hi: 8 },
  { faixa: 'B', n: 20, lo: 2, hi: 8 },
  { faixa: 'C', n: 30, lo: 2, hi: 8 },
];
const opt = (refLine, over = {}) =>
  buildChartOption({ kind: 'bar', rows, attrs: { x: 'faixa', y: 'n', refLine, ...over }, palette: ['#000'], dark: false });
const marcas = (o) => ({ linha: o.series[0].markLine, area: o.series[0].markArea });

describe('faixa de referência (markArea)', () => {
  it('array de dois vira FAIXA; escalar continua linha', () => {
    const { linha, area } = marcas(opt([{ axis: 'y', value: [12, 24], label: 'meta' }]));
    expect(linha).toBeUndefined();
    expect(area.data).toHaveLength(1);
    expect(area.data[0]).toEqual([{ yAxis: 12, name: 'meta' }, { yAxis: 24 }]);
    expect(marcas(opt([{ axis: 'y', value: 12 }])).area).toBeUndefined();
  });

  it('linha e faixa convivem na mesma série', () => {
    const { linha, area } = marcas(opt([{ axis: 'y', value: [12, 24], label: 'faixa' }, { axis: 'y', value: 18, label: 'meta' }]));
    expect(area.data).toHaveLength(1);
    expect(linha.data).toHaveLength(1);
    expect(linha.data[0].yAxis).toBe(18);
  });

  it('a faixa é silenciosa e fica atrás — é contexto, não mais um dado', () => {
    const { area } = marcas(opt([{ axis: 'y', value: [12, 24] }]));
    expect(area.silent).toBe(true);
    expect(area.itemStyle.opacity).toBeLessThan(0.2);
  });

  it('ordem invertida é normalizada, e início igual ao fim não marca nada', () => {
    expect(marcas(opt([{ axis: 'y', value: [24, 12] }])).area.data[0]).toEqual([{ yAxis: 12, name: undefined }, { yAxis: 24 }]);
    expect(marcas(opt([{ axis: 'y', value: [12, 12] }])).area).toBeUndefined();
    expect(marcas(opt([{ axis: 'y', value: [12] }])).area).toBeUndefined();
  });

  // O caso real do perfil-ies: hoje são TRÊS linhas (faixa_min, mediana,
  // faixa_max) para dizer "o meio ± MAD". Com faixa, viram uma faixa e uma linha.
  it('from com duas métricas lê as duas da primeira linha', () => {
    const { area } = marcas(opt([{ axis: 'y', from: ['lo', 'hi'], label: '± MAD' }]));
    expect(area.data[0]).toEqual([{ yAxis: 2, name: '± MAD' }, { yAxis: 8 }]);
  });

  it('no eixo CATEGÓRICO a faixa posiciona por índice, não por valor', () => {
    const cat = buildChartOption({
      kind: 'bar',
      rows: [{ ano: 2023, n: 1 }, { ano: 2024, n: 2 }, { ano: 2025, n: 3 }],
      attrs: { x: 'ano', y: 'n', refLine: [{ axis: 'x', value: [2024, 2025], label: 'contrato' }] },
      palette: ['#000'],
      dark: false,
    });
    expect(cat.series[0].markArea.data[0]).toEqual([{ xAxis: 1, name: 'contrato' }, { xAxis: 2 }]);
  });

  it('swapXY troca o eixo da faixa junto com o das barras', () => {
    const { area } = marcas(opt([{ axis: 'y', value: [12, 24] }], { swapXY: 'true' }));
    expect(Object.keys(area.data[0][0])).toContain('xAxis');
  });

  it('a marca de intervalo também aceita faixa', () => {
    const o = buildRangeOption({
      rows: [{ u: 'X', lo: 1, mid: 2, hi: 3 }],
      attrs: { x: 'u', low: 'lo', mid: 'mid', high: 'hi', refLine: [{ axis: 'y', value: [1.5, 2.5] }] },
      palette: ['#000'],
      dark: false,
    });
    expect(o.series[0].markArea.data[0]).toEqual([{ yAxis: 1.5, name: undefined }, { yAxis: 2.5 }]);
    expect(o.series[0].markLine).toBeUndefined();
  });
});

describe('a faixa atravessa o compilador e a validação', () => {
  const CAT = {
    model: 'm',
    fact: 'f',
    dimensions: { ano: { column: 'ano' } },
    metrics: { n: { column: 'n', agg: 'sum' }, lo: { column: 'lo', agg: 'min' }, hi: { column: 'hi', agg: 'max' } },
  };
  const plano = (reference, metrics = ['n']) => ({
    version: 1,
    title: 'T',
    visibility: 'public',
    catalog: 'm',
    pages: [{ path: 'a.md', title: 'A', blocks: [{ metrics, dims: [{ dim: 'ano' }], filters: [], style: 'graph.bar', reference }] }],
  });
  const val = (ref, m) => validateReportPlan(plano(ref, m), { catalog: CAT, factColumns: ['ano', 'n', 'lo', 'hi'] });

  it('faixa válida passa, por literal e por métrica', () => {
    expect(val([{ axis: 'y', value: [1, 2] }])).toEqual([]);
    expect(val([{ axis: 'y', from: ['lo', 'hi'] }], ['n', 'lo', 'hi'])).toEqual([]);
  });

  it('faixa malformada é recusada com o caminho', () => {
    expect(val([{ value: [1, 2, 3] }])[0].path).toMatch(/reference\[0\]\.value$/);
    expect(val([{ value: [1, 'x'] }])[0].message).toMatch(/dois números/);
    expect(val([{ value: [5, 5] }])[0].message).toMatch(/igual ao fim/);
    expect(val([{ from: ['lo', 'inexistente'] }], ['n', 'lo'])[0].message).toMatch(/inexistente/);
  });

  it('a métrica lida pela faixa entra na query mas NÃO vira série', () => {
    const vb = {
      v: 1,
      id: 'vb_x',
      source: { kind: 'semantic', name: 'm' },
      queries: [{ name: 'vb_x', sql: null }],
      dims: [{ dim: 'ano', alias: 'ano', column: 'ano' }],
      metrics: [{ name: 'n', alias: 'n' }, { name: 'lo', alias: 'lo' }, { name: 'hi', alias: 'hi' }],
      params: [],
      style: 'graph.bar',
      reference: [{ axis: 'y', from: ['lo', 'hi'], label: '± MAD' }],
      children: [],
    };
    const out = compileViewblock(vb, { vb, source: { name: 'f', columns: [] }, baseSql: 'select 1' });
    const tag = out.split('\n').find((l) => l.startsWith('<BarChart'));
    // lo/hi ficam no marcador e na query — é de lá que a faixa lê o valor —,
    // mas o `y=` leva só a métrica de verdade.
    expect(tag).toContain('y=n');
    expect(tag).not.toMatch(/y=\{/); // não virou multi-série
    expect(tag).toContain('refLine=');
    expect(out).toContain('"name":"lo"'); // segue no marcador
  });
});
