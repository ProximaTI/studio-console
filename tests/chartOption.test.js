import { describe, it, expect } from 'vitest';
import { buildChartOption } from '../shared/chartOption.js';

const rows = [
  { mes: 'jan', a: 10, b: 30 },
  { mes: 'fev', a: 20, b: 20 },
];

describe('buildChartOption', () => {
  it('bar simples: 1 série, categorias no eixo X, sem legenda', () => {
    const o = buildChartOption({ kind: 'bar', rows, attrs: { x: 'mes', y: 'a' } });
    expect(o.xAxis.data).toEqual(['jan', 'fev']);
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'bar', data: [10, 20] });
    expect(o.legend).toBeUndefined();
  });

  it('multi-série via y=[...] com legenda', () => {
    const o = buildChartOption({ kind: 'line', rows, attrs: { x: 'mes', y: ['a', 'b'] } });
    expect(o.series.map((s) => s.name)).toEqual(['a', 'b']);
    expect(o.legend).toBeTruthy();
  });

  it('swapXY inverte os eixos (barras horizontais)', () => {
    const o = buildChartOption({ kind: 'bar', rows, attrs: { x: 'mes', y: 'a', swapXY: 'true' } });
    expect(o.yAxis.type).toBe('category');
    expect(o.xAxis.type).toBe('value');
    expect(o.grid.containLabel).toBe(true);
  });

  it('stacked100 normaliza cada categoria para somar 100', () => {
    const o = buildChartOption({ kind: 'bar', rows, attrs: { x: 'mes', y: ['a', 'b'], type: 'stacked100' } });
    const somaJan = o.series.reduce((acc, s) => acc + s.data[0], 0);
    const somaFev = o.series.reduce((acc, s) => acc + s.data[1], 0);
    expect(Math.round(somaJan)).toBe(100);
    expect(Math.round(somaFev)).toBe(100);
    expect(o.series[0].stack).toBe('total');
    expect(o.yAxis.max).toBe(100);
  });

  it('series= quebra uma métrica em séries por categoria', () => {
    const r2 = [
      { ano: 2023, grupo: 'X', v: 1 },
      { ano: 2023, grupo: 'Y', v: 2 },
      { ano: 2024, grupo: 'X', v: 3 },
    ];
    const o = buildChartOption({ kind: 'line', rows: r2, attrs: { x: 'ano', y: 'v', series: 'grupo' } });
    expect(o.series.map((s) => s.name).sort()).toEqual(['X', 'Y']);
    // Y não tem valor em 2024 → preenche com 0 (mesmo comprimento das categorias)
    const y = o.series.find((s) => s.name === 'Y');
    expect(y.data).toHaveLength(2);
  });

  it('scatter (bubble): tamanho proporcional à coluna size', () => {
    const r3 = [
      { x: 1, y: 2, s: 100 },
      { x: 3, y: 4, s: 25 },
    ];
    const o = buildChartOption({ kind: 'scatter', rows: r3, attrs: { x: 'x', y: 'y', size: 's' } });
    const [p1, p2] = o.series[0].data;
    expect(p1.symbolSize).toBeGreaterThan(p2.symbolSize);
    expect(o.xAxis.type).toBe('value');
  });
});
