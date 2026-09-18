import { describe, it, expect } from 'vitest';
import { partitionBy, sharedDomain, isPanelChart, PANEL_HEIGHT } from '../shared/smallMultiples.js';
import { buildChartOption } from '../shared/chartOption.js';

// Saída típica do estilo `nested`: UMA query já particionada e ordenada
// (`order by <pai>, _rn`) — os grupos vêm contíguos e na ordem do SQL.
const ROWS = [
  { regiao: 'Sudeste', servico: 'Corte', faturamento: 100, _rn: 1 },
  { regiao: 'Sudeste', servico: 'Escova', faturamento: 60, _rn: 2 },
  { regiao: 'Norte', servico: 'Corte', faturamento: 10, _rn: 1 },
  { regiao: 'Norte', servico: 'Escova', faturamento: 4, _rn: 2 },
];

describe('partitionBy — uma fonte para os dois renderizadores', () => {
  it('agrupa preservando a ordem do SQL', () => {
    const { groups, total } = partitionBy(ROWS, 'regiao', 50);
    expect(total).toBe(2);
    expect(groups.map((g) => g.key)).toEqual(['Sudeste', 'Norte']); // NÃO alfabética
    expect(groups[0].rows).toHaveLength(2);
  });

  it('corta em maxGroups mas informa o total (a UI avisa o que ficou de fora)', () => {
    const { groups, total } = partitionBy(ROWS, 'regiao', 1);
    expect(groups).toHaveLength(1);
    expect(total).toBe(2);
  });

  it('compõe chave de múltiplas colunas e tolera entrada vazia', () => {
    expect(partitionBy(ROWS, 'regiao,servico', 50).total).toBe(4);
    expect(partitionBy(ROWS, ['regiao', 'servico'], 50).groups[0].key).toBe('Sudeste · Corte');
    expect(partitionBy(null, 'regiao', 50)).toEqual({ groups: [], total: 0 });
  });
});

describe('sharedDomain — o que transforma repetição em pequenos múltiplos', () => {
  it('cobre o máximo de TODOS os painéis, não o de cada um', () => {
    // A regressão que motivou o módulo: cada painel calculava o próprio eixo, e
    // a barra de 10 do Norte ficava do tamanho da de 100 do Sudeste.
    const { groups } = partitionBy(ROWS, 'regiao', 50);
    const d = sharedDomain(groups, 'faturamento', 'bar');
    expect(d).toEqual({ min: 0, max: 100 });

    const soNorte = sharedDomain([groups[1]], 'faturamento', 'bar');
    expect(soNorte.max).toBe(10); // prova que o domínio por painel seria outro
  });

  it('barra ancora no zero; linha usa o intervalo dos dados com folga', () => {
    const g = [{ key: 'x', rows: [{ v: 80 }, { v: 100 }] }];
    expect(sharedDomain(g, 'v', 'bar')).toEqual({ min: 0, max: 100 });
    const linha = sharedDomain(g, 'v', 'line');
    expect(linha.min).toBeGreaterThan(0); // não achata a forma da série
    expect(linha.min).toBeLessThan(80);
    expect(linha.max).toBeGreaterThan(100);
  });

  it('aceita múltiplas colunas de y e devolve null sem número algum', () => {
    const g = [{ key: 'x', rows: [{ a: 5, b: 30 }] }];
    expect(sharedDomain(g, ['a', 'b'], 'bar').max).toBe(30);
    expect(sharedDomain([{ key: 'x', rows: [{ a: 'texto' }] }], 'a', 'bar')).toBeNull();
    expect(sharedDomain([], 'a', 'bar')).toBeNull();
  });

  it('série constante ainda produz domínio utilizável', () => {
    expect(sharedDomain([{ key: 'x', rows: [{ v: 0 }] }], 'v', 'bar')).toEqual({ min: 0, max: 1 });
  });
});

describe('buildChartOption — o domínio compartilhado chega ao eixo', () => {
  const base = { kind: 'bar', rows: [{ x: 'a', y: 5 }], attrs: { x: 'x', y: 'y' }, palette: ['#2c8a4a'] };

  it('sem yDomain o eixo segue automático (nenhuma regressão)', () => {
    const o = buildChartOption(base);
    expect(o.yAxis.min).toBeUndefined();
    expect(o.yAxis.max).toBeUndefined();
  });

  it('com yDomain o eixo de valor fica fixo', () => {
    const o = buildChartOption({ ...base, yDomain: { min: 0, max: 100 } });
    expect(o.yAxis.min).toBe(0);
    expect(o.yAxis.max).toBe(100);
  });

  it('stacked100 tem domínio próprio e vence o compartilhado', () => {
    const o = buildChartOption({
      ...base,
      attrs: { x: 'x', y: 'y', type: 'stacked100' },
      yDomain: { min: 0, max: 100000 },
    });
    expect(o.yAxis.max).toBe(100);
    expect(o.yAxis.min).toBeUndefined();
  });

  it('em swapXY o domínio vai para o eixo X, que é o de valor', () => {
    const o = buildChartOption({ ...base, attrs: { x: 'x', y: 'y', swapXY: 'true' }, yDomain: { min: 0, max: 100 } });
    expect(o.xAxis.max).toBe(100);
  });
});

describe('forma do painel', () => {
  it('gráfico vai para grade; tabela segue empilhada em largura cheia', () => {
    expect(isPanelChart('graph.bar')).toBe(true);
    expect(isPanelChart('graph.line')).toBe(true);
    expect(isPanelChart('tabular')).toBe(false);
    expect(PANEL_HEIGHT).toBeLessThan(220); // menor que um gráfico solto: vê-se muitos juntos
  });
});
