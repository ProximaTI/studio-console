import { describe, it, expect } from 'vitest';
import { buildAreaMapOption, parseColorList, areaLabelLayout } from '../shared/mapOption.js';

const rows = [
  { uf: 'SP', qtd: 5891 },
  { uf: 'MG', qtd: 2227 },
  { uf: 'RR', qtd: 6 },
];
const attrs = { areaCol: 'uf', value: 'qtd', geoId: 'sigla' };

describe('parseColorList', () => {
  it('aceita a sintaxe Evidence colorPalette={[...]} já sem as chaves', () => {
    expect(parseColorList("['#e6eef7', '#7fb0d8','#236aa4']")).toEqual(['#e6eef7', '#7fb0d8', '#236aa4']);
  });
  it('aceita lista separada por vírgula, array real e vazio', () => {
    expect(parseColorList('#aaa,#bbb')).toEqual(['#aaa', '#bbb']);
    expect(parseColorList(['#aaa', '#bbb'])).toEqual(['#aaa', '#bbb']);
    expect(parseColorList(undefined)).toEqual([]);
  });
});

describe('buildAreaMapOption', () => {
  it('default: degradê claro→cor primária do tema, sem rótulos, max = maior valor', () => {
    const o = buildAreaMapOption({ rows, attrs, palette: ['#123456'], dark: false, mapName: 'brazil' });
    expect(o.visualMap.inRange.color).toEqual(['#eef2f7', '#123456']);
    expect(o.visualMap.max).toBe(5891);
    expect(o.series[0]).toMatchObject({ type: 'map', map: 'brazil', nameProperty: 'sigla' });
    expect(o.series[0].label.show).toBe(false);
    expect(o.series[0].data).toEqual([
      { name: 'SP', value: 5891 },
      { name: 'MG', value: 2227 },
      { name: 'RR', value: 6 },
    ]);
  });

  it('colorPalette com 3+ cores substitui o degradê (intermediários controlados pela página)', () => {
    const o = buildAreaMapOption({
      rows,
      attrs: { ...attrs, colorPalette: "['#e6eef7','#7fb0d8','#236aa4']" },
      dark: false,
    });
    expect(o.visualMap.inRange.color).toEqual(['#e6eef7', '#7fb0d8', '#236aa4']);
  });

  it('colorPalette com 1 cor só é ignorada (volta ao default)', () => {
    const o = buildAreaMapOption({ rows, attrs: { ...attrs, colorPalette: '#000' }, dark: true });
    expect(o.visualMap.inRange.color).toEqual(['#1d2330', '#236aa4']);
  });

  it('showLabels=true imprime a quantidade formatada pt-BR dentro da área', () => {
    const o = buildAreaMapOption({ rows, attrs: { ...attrs, showLabels: 'true' }, dark: false });
    const label = o.series[0].label;
    expect(label.show).toBe(true);
    expect(label.formatter({ name: 'SP', value: 5891 })).toBe('5.891');
    // nenhum rótulo é escondido por sobreposição (o DF precisa aparecer)
    expect(o.series[0].labelLayout).toBe(areaLabelLayout);
    expect(o.series[0].labelLine.show).toBe(true);
    // tooltip continua com nome + valor
    expect(o.tooltip.formatter({ name: 'SP', value: 5891 })).toBe('SP: 5.891');
  });
});

describe('areaLabelLayout', () => {
  it('área pequena (DF): rótulo fora, à direita, com linha-guia a partir da borda', () => {
    const l = areaLabelLayout({ rect: { x: 100, y: 200, width: 9, height: 7 } });
    expect(l).toMatchObject({ x: 143, y: 203.5, align: 'left', verticalAlign: 'middle' });
    expect(l.labelLinePoints).toEqual([[109, 203.5], [139, 203.5]]);
  });
  it('área grande: fica no centro e só desloca na vertical se colidir', () => {
    expect(areaLabelLayout({ rect: { x: 0, y: 0, width: 80, height: 60 } })).toEqual({ moveOverlap: 'shiftY' });
    expect(areaLabelLayout({})).toEqual({});
  });
});
