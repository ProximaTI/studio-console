import { describe, it, expect } from 'vitest';
import { styleById, compileViewblock } from '../shared/viewStyles.js';
import { findViewblocks } from '../shared/viewblock.js';
import { lintEvidenceCompat } from '../shared/evidenceLint.js';
import { parseCells, serializeCells } from '../web/src/notebook/cells';

// Fixture de uma tabela de colaboração bilateral agregada — a spec
// frisa: os papéis são genéricos; redes_nodes/edges são fixture, não contrato.
const BILATERAL = {
  name: 'agg_colab_bilateral',
  columns: [
    { name: 'inst_a', type: 'VARCHAR' },
    { name: 'inst_b', type: 'VARCHAR' },
    { name: 'inst_b_name', type: 'VARCHAR' },
    { name: 'inst_b_country', type: 'VARCHAR' },
    { name: 'collab_score', type: 'DOUBLE' },
    { name: 'shared_works', type: 'BIGINT' },
  ],
};
const GEO = {
  name: 'colab_paises',
  columns: [
    { name: 'pa', type: 'VARCHAR' },
    { name: 'la', type: 'DOUBLE' },
    { name: 'lo', type: 'DOUBLE' },
    { name: 'pb', type: 'VARCHAR' },
    { name: 'lb', type: 'DOUBLE' },
    { name: 'ob', type: 'DOUBLE' },
    { name: 'n', type: 'BIGINT' },
  ],
};

const base = (over = {}) => ({
  v: 1,
  id: 'vb_roles1',
  source: { kind: 'source', name: 'agg_colab_bilateral' },
  queries: [{ name: 'vb_roles1', sql: null }],
  dims: [],
  metrics: [],
  params: [],
  style: 'collabgraph',
  children: [],
  ...over,
});

describe('estilos com papéis — contratos', () => {
  it('sem papéis mapeados: ok=false com needsRoles (galeria deixa clicar p/ mapear)', () => {
    const r = styleById('collabgraph').requires(base(), BILATERAL);
    expect(r.ok).toBe(false);
    expect(r.needsRoles).toBe(true);
    expect(r.reason).toContain('source');
    const c = styleById('connectionmap').requires(base({ style: 'connectionmap' }), GEO);
    expect(c.needsRoles).toBe(true);
  });

  it('papel mapeado para coluna inexistente é rejeitado', () => {
    const vb = base({ roles: { source: 'inst_a', target: 'coluna_que_nao_existe' } });
    const r = styleById('collabgraph').requires(vb, BILATERAL);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('coluna_que_nao_existe');
  });

  it('areamap: 1 dim geográfica (uf/sigla) + métrica', () => {
    const ok = base({ style: 'areamap', dims: [{ table: 't', column: 'uf' }], metrics: [{ column: 'valor', agg: 'sum' }] });
    expect(styleById('areamap').requires(ok, BILATERAL).ok).toBe(true);
    const bad = base({ style: 'areamap', dims: [{ table: 't', column: 'unidade' }], metrics: [{ column: 'valor', agg: 'sum' }] });
    expect(styleById('areamap').requires(bad, BILATERAL).ok).toBe(false);
  });
});

describe('collabgraph — bloco com 2 células SQL (spec §7.10)', () => {
  const vb = base({
    roles: { source: 'inst_a', target: 'inst_b', label: 'inst_b_name', weight: 'collab_score' },
    params: [{ name: 'pais', type: 'enum', from: 'inst_b_country', default: '%', label: 'País' }],
  });
  const block = compileViewblock(vb, { vb, source: BILATERAL, baseSql: '' });

  it('emite nodes + edges com os aliases do componente', () => {
    expect(block).toContain('```sql vb_roles1_nodes');
    expect(block).toContain('```sql vb_roles1_edges');
    expect(block).toContain('"inst_a" as source_id');
    expect(block).toContain('"inst_b" as target_id');
    expect(block).toContain('"inst_b_name" as target_name');
    expect(block).toContain('"collab_score" as weight');
    expect(block).toContain('union');
    expect(block).toContain('<CollaborationGraph nodes=vb_roles1_nodes edges=vb_roles1_edges nodeId=id nodeLabel=label edgeWeight=weight');
  });

  it('marcador registra queries[] com os DOIS nomes (multi-query desde a v1)', () => {
    const meta = findViewblocks('# T\n\n' + block + '\n')[0].meta;
    expect(meta.queries).toEqual([
      { name: 'vb_roles1_nodes', sql: null },
      { name: 'vb_roles1_edges', sql: null },
    ]);
  });

  it('param enum entra nas DUAS queries e no dropdown', () => {
    expect(block).toContain('vb_roles1_pais_opts');
    const likes = block.match(/like '\$\{inputs\.pais\.value\}'/g) || [];
    expect(likes.length).toBeGreaterThanOrEqual(3); // nodes (2 lados do union) + edges
  });

  it('round-trip canônico + lint limpo', () => {
    const page = '# T\n\n' + block + '\n';
    expect(serializeCells(parseCells(page))).toBe(page);
    expect(lintEvidenceCompat(page).filter((f) => f.level === 'error')).toEqual([]);
  });
});

describe('connectionmap — papéis viram attrs da tag', () => {
  const vb = base({
    id: 'vb_geo1',
    source: { kind: 'source', name: 'colab_paises' },
    queries: [{ name: 'vb_geo1', sql: null }],
    style: 'connectionmap',
    roles: { fromName: 'pa', fromLat: 'la', fromLon: 'lo', toName: 'pb', toLat: 'lb', toLon: 'ob', weight: 'n', map: 'world' },
  });
  const block = compileViewblock(vb, { vb, source: GEO, baseSql: '' });

  it('projeta as colunas mapeadas e emite a tag com os papéis', () => {
    expect(block).toContain('select "pa", "la", "lo", "pb", "lb", "ob", "n"');
    expect(block).toContain('<ConnectionMap data={vb_geo1} map=world fromName=pa fromLat=la fromLon=lo toName=pb toLat=lb toLon=ob weight=n/>');
  });

  it('reduz a UMA query no marcador', () => {
    const meta = findViewblocks('# T\n\n' + block + '\n')[0].meta;
    expect(meta.queries).toEqual([{ name: 'vb_geo1', sql: null }]);
  });
});
