import { describe, it, expect } from 'vitest';
import { styleById, compileViewblock } from '../shared/viewStyles.js';
import { buildRangeOption } from '../shared/chartOption.js';

// O catálogo aprendeu a calcular dispersão (p25/mediana/p75) mas o produto só
// sabia desenhá-la como três colunas ou três barras — três números, nenhuma
// faixa. Esta é a marca que fecha a lacuna.
const SOURCE = { name: 'comissoes', columns: [{ name: 'unidade', type: 'VARCHAR' }, { name: 'valor', type: 'DOUBLE' }] };
const vb = (over = {}) => ({
  v: 1,
  id: 'vb_r1',
  source: { kind: 'semantic', name: 'comissoes' },
  queries: [{ name: 'vb_r1', sql: null }],
  dims: [{ dim: 'unidade', alias: 'unidade', column: 'unidade' }],
  metrics: [
    { name: 'p25', alias: 'ticket_p25', column: 'ticket_p25' },
    { name: 'mediana', alias: 'ticket_mediana', column: 'ticket_mediana', fmt: 'brl' },
    { name: 'p75', alias: 'ticket_p75', column: 'ticket_p75' },
  ],
  params: [],
  style: 'graph.range',
  children: [],
  ...over,
});
const compile = (v) => compileViewblock(v, { vb: v, source: SOURCE, baseSql: 'select 1' });

describe('contrato do estilo graph.range', () => {
  it('exige 1 dimensão e EXATAMENTE 3 métricas', () => {
    const s = styleById('graph.range');
    expect(s.requires(vb(), SOURCE).ok).toBe(true);
    expect(s.requires(vb({ metrics: vb().metrics.slice(0, 2) }), SOURCE).ok).toBe(false);
    expect(s.requires(vb({ metrics: [...vb().metrics, { alias: 'x', column: 'x' }] }), SOURCE).ok).toBe(false);
    expect(s.requires(vb({ dims: [] }), SOURCE).ok).toBe(false);
  });

  it('o motivo ENSINA a ordem, que é a convenção do estilo', () => {
    const r = styleById('graph.range').requires(vb({ metrics: [] }), SOURCE);
    expect(r.reason).toMatch(/mínimo.*centro.*máximo/);
  });

  it('compila para UMA marca, não três séries', () => {
    const out = compile(vb());
    expect(out).toContain('<RangeChart data={vb_r1} x=unidade low=ticket_p25 mid=ticket_mediana high=ticket_p75 yFmt=brl/>');
    expect(out).not.toContain('BarChart');
  });

  it('o fmt vem da métrica do CENTRO (é a que rotula o eixo)', () => {
    const semFmt = vb({ metrics: vb().metrics.map((m) => ({ ...m, fmt: undefined })) });
    expect(compile(semFmt)).not.toContain('yFmt');
  });
});

describe('a opção ECharts da marca de intervalo', () => {
  const rows = [
    { unidade: 'Batel', lo: 60, mid: 96, hi: 140 },
    { unidade: 'Asa Sul', lo: 50, mid: 80, hi: 300 },
  ];
  const opt = (over = {}) =>
    buildRangeOption({ rows, attrs: { x: 'unidade', low: 'lo', mid: 'mid', high: 'hi', ...over }, palette: ['#a63d5f'], dark: false });

  it('os TRÊS valores entram no domínio do eixo — senão a faixa sai cortada', () => {
    const o = opt();
    expect(o.series[0].encode).toEqual({ x: 0, y: [1, 2, 3] });
    expect(o.series[0].data[0]).toEqual(['Batel', 60, 96, 140]);
  });

  it('desenha uma marca por categoria: haste, duas tampas e o centro', () => {
    const o = opt();
    // renderItem é a marca; simula a chamada do ECharts com uma api mínima
    const api = {
      value: (i) => o.series[0].data[1][i],
      coord: ([, v]) => [100, 400 - v], // y invertido, como no canvas
      size: () => [40, 0],
    };
    const g = o.series[0].renderItem({}, api);
    expect(g.type).toBe('group');
    expect(g.children).toHaveLength(4);
    const [haste, capBaixo, capAlto, centro] = g.children;
    expect(haste.shape.y1).toBeGreaterThan(haste.shape.y2); // mínimo abaixo do máximo
    expect(capBaixo.shape.x2 - capBaixo.shape.x1).toBeGreaterThan(0);
    expect(capAlto.type).toBe('line');
    expect(centro.type).toBe('circle');
    expect(centro.style.fill).toBe('#a63d5f'); // cor de MARCA, não literal
  });

  it('linha sem os três números não vira marca pela metade', () => {
    const o = buildRangeOption({
      rows: [{ unidade: 'X', lo: 1, mid: null, hi: 3 }],
      attrs: { x: 'unidade', low: 'lo', mid: 'mid', high: 'hi' },
      palette: ['#000'],
    });
    expect(o.series[0].data).toHaveLength(0);
  });

  it('o tooltip nomeia as três pontas e respeita o fmt', () => {
    const t = opt({ yFmt: 'brl' }).tooltip.formatter({ value: ['Batel', 60, 96, 140] });
    expect(t).toMatch(/mínimo/);
    expect(t).toMatch(/centro/);
    expect(t).toMatch(/máximo/);
    expect(t).toContain('R$');
  });
});
