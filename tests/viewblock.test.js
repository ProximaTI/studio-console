import { describe, it, expect } from 'vitest';
import {
  serializeVbMeta,
  parseVbMeta,
  findViewblocks,
  stripViewblockMarkers,
  spliceViewblock,
} from '../shared/viewblock.js';
import { parseBlocks, stripHtmlComments } from '../shared/parser.js';
import { parseCells, serializeCells } from '../web/src/notebook/cells';
import { computeVbRanges, isMarkerOnlyCell } from '../web/src/notebook/viewblocks';

const VB = {
  v: 1,
  id: 'vb_ab12cd',
  source: { kind: 'source', name: 'comissoes' },
  queries: [{ name: 'vb_ab12cd', sql: null }],
  dims: [{ table: 'comissoes', column: 'unidade' }],
  metrics: [{ column: 'atendimento_id', agg: 'count_distinct', label: 'Atendimentos' }],
  params: [{ name: 'ano', type: 'enum', from: 'ano', default: '%', label: 'Ano' }],
  style: 'graph.bar',
  children: [],
};

// Exemplo do §4 da spec na FORMA CANÔNICA (blocos separados por linha em
// branco — é o que o compilador emite e o que o serializeCells produz).
const PAGE =
  [
    '# Painel',
    serializeVbMeta(VB),
    '```sql vb_ab12cd\nselect unidade, count(distinct atendimento_id) as atendimentos from comissoes group by 1\n```',
    '<BarChart data={vb_ab12cd} x=unidade y=atendimentos/>',
    '<!-- /viewblock -->',
    'Texto livre depois.',
  ].join('\n\n') + '\n';
const LINES = PAGE.split('\n');
const OPEN_LINE = LINES.findIndex((l) => l.startsWith('<!-- viewblock'));
const CLOSE_LINE = LINES.findIndex((l) => l.startsWith('<!-- /viewblock'));

describe('serializeVbMeta / parseVbMeta', () => {
  it('round-trip do meta, inclusive com ">" e "-->" dentro de strings', () => {
    const vb = { ...VB, metrics: [{ column: 'atendimento_id', agg: 'count_distinct', label: 'a -> b --> c' }] };
    const line = serializeVbMeta(vb);
    expect(line).toMatch(/^<!-- viewblock v1 \{.*\} -->$/);
    // nenhum '>' aparece no JSON — o único '-->' é o terminador do comentário
    expect(line.slice(0, -3)).not.toContain('>');
    const back = parseVbMeta(line);
    expect(back).toEqual(vb);
  });

  it('preserva chaves desconhecidas (forward-compat F3)', () => {
    const line = serializeVbMeta({ ...VB, futuro: { nested: [1, 2] } });
    expect(parseVbMeta(line).futuro).toEqual({ nested: [1, 2] });
  });

  it('linha comum ou JSON inválido não é marcador', () => {
    expect(parseVbMeta('<!-- comentário normal -->')).toBeNull();
    expect(parseVbMeta('<!-- viewblock v1 {quebrado -->')).toBeNull();
  });
});

describe('findViewblocks', () => {
  it('encontra o bloco com linhas corretas e meta parseado', () => {
    const vbs = findViewblocks(PAGE);
    expect(vbs).toHaveLength(1);
    expect(vbs[0].meta.id).toBe('vb_ab12cd');
    expect(vbs[0].openLine).toBe(OPEN_LINE);
    expect(vbs[0].closeLine).toBe(CLOSE_LINE);
    expect(vbs[0].children).toEqual([]);
  });

  it('aceita marcadores ANINHADOS (fixture pai+filho — contrato da F3)', () => {
    const inner = { ...VB, id: 'vb_filho' };
    const outer = { ...VB, id: 'vb_pai', style: 'nested' };
    const md = [
      serializeVbMeta(outer),
      'texto do pai',
      serializeVbMeta(inner),
      '<BigValue data={x} value=v/>',
      '<!-- /viewblock -->',
      '<!-- /viewblock -->',
    ].join('\n');
    const vbs = findViewblocks(md);
    expect(vbs).toHaveLength(1);
    expect(vbs[0].meta.id).toBe('vb_pai');
    expect(vbs[0].children).toHaveLength(1);
    expect(vbs[0].children[0].meta.id).toBe('vb_filho');
    expect(vbs[0].children[0].openLine).toBe(2);
    expect(vbs[0].children[0].closeLine).toBe(4);
    expect(vbs[0].closeLine).toBe(5);
  });

  it('ignora marcadores dentro de cercas ``` e blocos sem fechamento', () => {
    const md = ['```sql q', serializeVbMeta(VB), '```', serializeVbMeta({ ...VB, id: 'vb_aberto' }), 'sem fechamento'].join('\n');
    expect(findViewblocks(md)).toEqual([]);
  });
});

describe('stripViewblockMarkers / spliceViewblock', () => {
  it('Desacoplar remove SÓ as duas linhas de marcador (diff mínimo)', () => {
    const out = stripViewblockMarkers(PAGE, 'vb_ab12cd');
    const expected = LINES.filter((_, i) => i !== OPEN_LINE && i !== CLOSE_LINE).join('\n');
    expect(out).toBe(expected);
    expect(findViewblocks(out)).toEqual([]);
  });

  it('splice substitui o bloco inteiro preservando o resto', () => {
    const novo = [serializeVbMeta({ ...VB, style: 'tabular' }), '<DataTable data={vb_ab12cd}/>', '<!-- /viewblock -->'].join('\n');
    const out = spliceViewblock(PAGE, 'vb_ab12cd', novo);
    expect(out).toContain('<DataTable data={vb_ab12cd}/>');
    expect(out).not.toContain('<BarChart');
    expect(out.split('\n')[0]).toBe('# Painel'); // antes preservado
    expect(out).toContain('Texto livre depois.'); // depois preservado
    expect(findViewblocks(out)[0].meta.style).toBe('tabular');
  });
});

describe('integração com parser e células (round-trip)', () => {
  it('parseBlocks não muda: marcadores são texto md, sql intacto', () => {
    const blocks = parseBlocks(PAGE);
    const sql = blocks.find((b) => b.type === 'sql');
    expect(sql.name).toBe('vb_ab12cd');
    const mdTexts = blocks.filter((b) => b.type === 'md').map((b) => b.text).join('\n');
    expect(mdTexts).toContain('viewblock v1');
  });

  it('stripHtmlComments remove os marcadores no render', () => {
    const stripped = stripHtmlComments(PAGE);
    expect(stripped).not.toContain('viewblock');
    expect(stripped).toContain('<BarChart');
  });

  it('células round-tripam o View Block byte a byte', () => {
    const cells = parseCells(PAGE);
    expect(serializeCells(cells)).toBe(PAGE);
  });

  it('computeVbRanges agrupa as células do bloco e marca a primeira', () => {
    const cells = parseCells(PAGE);
    const { ranges, states } = computeVbRanges(cells);
    expect(ranges).toHaveLength(1);
    const r = ranges[0];
    expect(r.id).toBe('vb_ab12cd');
    // range cobre: marcador de abertura, célula sql, tag e fechamento
    const inside = states.filter((s) => s.vb).length;
    expect(inside).toBe(r.end - r.start + 1);
    expect(states[r.start].isFirst).toBe(true);
    // células fora (título e texto final) ficam livres
    expect(states[0].vb).toBeNull();
    expect(states[states.length - 1].vb).toBeNull();
  });

  it('isMarkerOnlyCell identifica células que são só marcador', () => {
    const cells = parseCells(PAGE);
    const markers = cells.filter((c) => isMarkerOnlyCell(c));
    expect(markers.length).toBeGreaterThanOrEqual(1); // pelo menos o fechamento
    expect(isMarkerOnlyCell({ id: 'x', type: 'text', source: 'texto normal' })).toBe(false);
  });
});
