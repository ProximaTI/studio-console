import { describe, it, expect } from 'vitest';
import { compileViewblock } from '../shared/viewStyles.js';

// Os estilos que montam o PRÓPRIO SQL (pivot, connectionmap, collabgraph) usavam
// `vb.source.name` no FROM. Num bloco semântico isso é o MODELO do catálogo, não
// a TABELA — e os dois diferem em projetos reais (`producao` vs
// `producao_ies_2021_2025`). O SQL saía apontando para tabela inexistente e só
// quebrava na hora de rodar.
//
// No `projects/exemplo` model e fact coincidem, o que mascarava o defeito: por
// isso a fixture aqui os separa de propósito.
const MODELO = 'producao';
const TABELA = 'producao_ies_2021_2025';
const SRC = {
  name: TABELA, // ctx.source é o FATO (é o que compileSemanticBlock passa)
  columns: [
    { name: 'origem', type: 'VARCHAR' },
    { name: 'destino', type: 'VARCHAR' },
    { name: 'olat', type: 'DOUBLE' },
    { name: 'olon', type: 'DOUBLE' },
    { name: 'dlat', type: 'DOUBLE' },
    { name: 'dlon', type: 'DOUBLE' },
    { name: 'ies', type: 'VARCHAR' },
    { name: 'campo', type: 'VARCHAR' },
    { name: 'artigos', type: 'BIGINT' },
  ],
};
const base = (over) => ({
  v: 1,
  id: 'vb_x',
  queries: [{ name: 'vb_x', sql: null }, { name: 'vb_x_2', sql: null }],
  dims: [],
  metrics: [],
  params: [],
  children: [],
  ...over,
});
const semantico = (over) => base({ source: { kind: 'semantic', name: MODELO }, ...over });
const compila = (vb) => compileViewblock(vb, { vb, source: SRC, baseSql: 'select 1' });
const froms = (out) => [...out.matchAll(/from\s+"([^"]+)"/gi)].map((m) => m[1]);

const ROLES_MAPA = { fromName: 'origem', fromLat: 'olat', fromLon: 'olon', toName: 'destino', toLat: 'dlat', toLon: 'dlon' };

describe('FROM dos estilos que montam o próprio SQL', () => {
  it('bloco semântico aponta para o FATO, não para o modelo', () => {
    for (const [estilo, extra] of [
      ['connectionmap', { roles: ROLES_MAPA }],
      ['collabgraph', { roles: { source: 'origem', target: 'destino' } }],
      [
        'pivot',
        {
          dims: [{ dim: 'ies', alias: 'ies', column: 'ies' }, { dim: 'campo', alias: 'campo', column: 'campo' }],
          metrics: [{ name: 'artigos', alias: 'artigos', column: 'artigos' }],
          pivot: { rows: ['ies'], cols: 'campo', measure: 'artigos', frozenCols: ['A', 'B'] },
        },
      ],
    ]) {
      const out = compila(semantico({ style: estilo, ...extra }));
      const tabelas = froms(out);
      expect(tabelas, estilo).toContain(TABELA);
      expect(tabelas, `${estilo} ainda aponta para o modelo`).not.toContain(MODELO);
    }
  });

  // A CTE de uma fonte query/model é nomeada com o nome da FONTE. Trocar o FROM
  // ali quebraria a referência — por isso a regra é condicional ao caminho.
  it('fonte crua e query/model continuam usando o nome da FONTE', () => {
    const cru = compila(base({ source: { kind: 'source', name: 'colab' }, style: 'collabgraph', roles: { source: 'origem', target: 'destino' } }));
    expect(froms(cru)).toContain('colab');

    const vb = base({ source: { kind: 'query', name: 'minha_query' }, style: 'collabgraph', roles: { source: 'origem', target: 'destino' } });
    const comCte = compileViewblock(vb, {
      vb,
      source: SRC,
      baseSql: 'select 1',
      ctePrefix: 'with "minha_query" as (\nselect 1\n)\n',
    });
    // o FROM tem de casar com o nome da CTE, não com o do sourceInfo
    expect(froms(comCte)).toContain('minha_query');
    expect(froms(comCte)).not.toContain(TABELA);
  });
});
