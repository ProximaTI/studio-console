import { describe, it, expect } from 'vitest';
import { buildChartOption } from '../shared/chartOption.js';

const rows = [
  { mes: 'jan', a: 10, b: 30 },
  { mes: 'fev', a: 20, b: 20 },
];

describe('linha de referência (refLine)', () => {
  const rows = [
    { faixa: 1, sedes: 10, mediana: 7 },
    { faixa: 7, sedes: 80, mediana: 7 },
    { faixa: 11, sedes: 2, mediana: 7 },
  ];
  const opt = (refLine, over = {}) =>
    buildChartOption({ kind: 'bar', rows, attrs: { x: 'faixa', y: 'sedes', refLine, ...over }, palette: ['#000'], dark: false });

  it('valor literal vira markLine no eixo de VALOR', () => {
    const ml = opt([{ axis: 'y', value: 50, label: 'corte' }]).series[0].markLine;
    expect(ml.data).toEqual([expect.objectContaining({ yAxis: 50, name: 'corte' })]);
  });

  it('from lê a coluna na 1ª linha; no eixo de categoria posiciona pelo ÍNDICE da categoria', () => {
    const ml = opt([{ axis: 'x', from: 'mediana', label: 'mediana' }]).series[0].markLine;
    // mediana = 7 → categoria 7 é a SEGUNDA barra (índice 1), não a 7ª
    expect(ml.data[0].xAxis).toBe(1);
  });

  it('swapXY troca o eixo de cada referência', () => {
    const ml = opt([{ axis: 'y', value: 50 }], { swapXY: 'true' }).series[0].markLine;
    expect(ml.data[0].xAxis).toBe(50);
  });

  it('referência sem valor numérico não vira linha — e sem refLine não há markLine', () => {
    expect(opt([{ axis: 'y', from: 'nao_existe' }]).series[0].markLine).toBeUndefined();
    expect(opt([{ axis: 'y', value: 'muito' }]).series[0].markLine).toBeUndefined();
    expect(opt(undefined).series[0].markLine).toBeUndefined();
    // JSON como string (é assim que chega do atributo da página)
    const ml = opt('[{"axis":"y","value":3}]').series[0].markLine;
    expect(ml.data[0].yAxis).toBe(3);
  });
});

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

describe('empilhado em 100%: o eixo diz de que é a porcentagem', () => {
  const rows = [
    { nat: 'Federal', origem: 'nacional', works: 280 },
    { nat: 'Federal', origem: 'exterior', works: 253 },
    { nat: 'Privada', origem: 'nacional', works: 116 },
    { nat: 'Privada', origem: 'exterior', works: 80 },
  ];
  const attrs = { x: 'nat', y: 'works', series: 'origem', type: 'stacked100', yFmt: 'num0' };

  it('eixo e tooltip saem com %, e cada coluna soma 100', () => {
    const o = buildChartOption({ kind: 'bar', rows, attrs, palette: ['#1351b4', '#adcdff'], dark: false });
    expect(o.yAxis.axisLabel.formatter(80)).toBe('80%');
    expect(o.tooltip.valueFormatter(52.5)).toBe('52,5%');
    expect(o.yAxis.max).toBe(100);
    const soma = o.series.reduce((t, s) => t + Number(s.data[0]), 0);
    expect(Math.round(soma)).toBe(100);
  });

  it('empilhado absoluto continua no fmt da métrica', () => {
    const o = buildChartOption({ kind: 'bar', rows, attrs: { ...attrs, type: 'stacked' }, palette: ['#1351b4'], dark: false });
    expect(o.yAxis.axisLabel.formatter(1234)).toBe('1.234');
  });
});

describe('bolha: fmt e rótulo de cada métrica chegam ao eixo que ela ocupa', () => {
  const rows = [
    { pais: 'Brasil', intl: 0.29, cit: 0.75, sh: 143969.8 },
    { pais: 'Reino Unido', intl: 0.663, cit: 2.15, sh: 145678.7 },
  ];
  const attrs = {
    x: 'intl', y: 'cit', size: 'sh', label: 'pais',
    xFmt: 'pct1', yFmt: 'num1', sizeFmt: 'num0',
    xAxisTitle: '% internacional', yAxisTitle: 'Citações por work', sizeLabel: 'Share',
  };
  const o = buildChartOption({ kind: 'scatter', rows, attrs });

  it('eixo X de valor com título e formato próprios; eixo Y idem', () => {
    expect(o.xAxis.name).toBe('% internacional');
    expect(o.xAxis.axisLabel.formatter(0.29)).toBe('29,0%');
    expect(o.yAxis.name).toBe('Citações por work');
    expect(o.yAxis.axisLabel.formatter(0.75)).toBe('0,8');
  });

  it('tooltip nomeia os três papéis com os formatos das métricas', () => {
    const p = { name: 'Brasil', value: [0.29, 0.75], data: o.series[0].data[0] };
    const tip = o.tooltip.formatter(p);
    expect(tip).toContain('<b>Brasil</b>');
    expect(tip).toContain('% internacional: 29,0%');
    expect(tip).toContain('Citações por work: 0,8');
    expect(tip).toContain('Share: 143.970');
  });

  it('sem fmt nem título, o eixo sai como antes (valor cru, sem nome)', () => {
    const o2 = buildChartOption({ kind: 'scatter', rows, attrs: { x: 'intl', y: 'cit' } });
    expect(o2.xAxis.name).toBeUndefined();
    expect(o2.xAxis.axisLabel.formatter).toBeUndefined();
    expect(o2.tooltip.formatter({ value: [0.29, 0.75], data: {} })).toBe('intl: 0.29<br/>cit: 0.75');
  });
});

describe('bolha: referência no eixo X posiciona pelo VALOR, não pelo índice', () => {
  // Uma linha tem IE exatamente 1 — no eixo categórico isso viraria "índice 1";
  // no eixo de valor da bolha a marca tem de ficar em x = 1.
  const rows = [
    { area: 'A', ie: 0.4, cit: 1.2 },
    { area: 'B', ie: 1, cit: 0.9 },
    { area: 'C', ie: 2.5, cit: 0.3 },
  ];
  const attrs = { x: 'ie', y: 'cit', label: 'area', refLine: [{ value: 1, axis: 'x', label: 'IE = 1' }] };
  it('markLine em xAxis: 1', () => {
    const o = buildChartOption({ kind: 'scatter', rows, attrs });
    expect(o.series[0].markLine.data[0].xAxis).toBe(1);
  });
});
