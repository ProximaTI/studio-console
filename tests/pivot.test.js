import { describe, it, expect } from 'vitest';
import { styleById, compileViewblock } from '../shared/viewStyles.js';
import { findViewblocks, parseVbMeta, serializeVbMeta } from '../shared/viewblock.js';
import { parseCells, serializeCells } from '../web/src/notebook/cells';

const SRC = {
  name: 'comissoes',
  columns: [
    { name: 'uf', type: 'VARCHAR' },
    { name: 'unidade', type: 'VARCHAR' },
    { name: 'atendimento_id', type: 'VARCHAR' },
    { name: 'ano', type: 'BIGINT' },
  ],
};

const vbOf = (pivot, over = {}) => ({
  v: 1,
  id: 'vb_piv1',
  source: { kind: 'source', name: 'comissoes' },
  queries: [{ name: 'vb_piv1', sql: null }],
  dims: [],
  metrics: [],
  params: [],
  style: 'pivot',
  pivot,
  children: [],
  ...over,
});

const PIVOT = {
  rows: ['uf'],
  cols: 'unidade',
  measure: { column: 'atendimento_id', agg: 'count_distinct' },
  frozenCols: ['Vila Madalena', 'Copacabana', "O'Reilly & \"Cia\""],
  others: true,
};

describe('estilo pivot — colunas congeladas', () => {
  it('sem config ou sem congelar: needsRoles (galeria abre a sub-etapa)', () => {
    expect(styleById('pivot').requires(vbOf(null), SRC).needsRoles).toBe(true);
    const semFreeze = styleById('pivot').requires(vbOf({ ...PIVOT, frozenCols: [] }), SRC);
    expect(semFreeze.ok).toBe(false);
    expect(semFreeze.reason).toContain('congele');
  });

  it('compila agregação condicional determinística com quoting correto', () => {
    const vb = vbOf(PIVOT);
    const block = compileViewblock(vb, { vb, source: SRC, baseSql: '' });
    expect(block).toContain(`count(distinct case when cast("unidade" as varchar) = 'Vila Madalena' then "atendimento_id" end) as "Vila Madalena"`);
    // literal: ' vira ''; alias: " vira ""
    expect(block).toContain("= 'O''Reilly & \"Cia\"'");
    expect(block).toContain('as "O\'Reilly & ""Cia"""');
    // Outros pega o que ficou fora da lista congelada
    expect(block).toContain(`not in ('Vila Madalena', 'Copacabana', 'O''Reilly & "Cia"')`);
    expect(block).toContain('as "Outros"');
    expect(block).toContain('group by 1');
    // determinístico
    expect(compileViewblock(vb, { vb, source: SRC, baseSql: '' })).toBe(block);
  });

  it('others=false não emite a coluna Outros', () => {
    const vb = vbOf({ ...PIVOT, others: false });
    const block = compileViewblock(vb, { vb, source: SRC, baseSql: '' });
    expect(block).not.toContain('Outros');
  });

  it('emite <Column/> por linha + coluna congelada (fmt declarável depois)', () => {
    const vb = vbOf(PIVOT);
    const block = compileViewblock(vb, { vb, source: SRC, baseSql: '' });
    expect(block).toContain('<Column id=uf/>');
    expect(block).toContain('<Column id="Vila Madalena"/>');
    expect(block).toContain('<Column id="Outros"/>');
  });

  it('params entram no WHERE; múltiplas linhas agrupam por posição', () => {
    const vb = vbOf(
      { ...PIVOT, rows: ['uf', 'ano'] },
      { params: [{ name: 'ano', type: 'enum', from: 'ano', default: '%' }] }
    );
    const block = compileViewblock(vb, { vb, source: SRC, baseSql: '' });
    expect(block).toContain("like '${inputs.ano.value}'");
    expect(block).toContain('group by 1, 2');
  });

  it('marcador preserva pivot (frozenCols congeladas) no round-trip', () => {
    const vb = vbOf(PIVOT);
    const block = compileViewblock(vb, { vb, source: SRC, baseSql: '' });
    const page = '# T\n\n' + block + '\n';
    const meta = findViewblocks(page)[0].meta;
    expect(meta.pivot).toEqual(PIVOT);
    expect(parseVbMeta(serializeVbMeta(meta)).pivot.frozenCols).toEqual(PIVOT.frozenCols);
    expect(serializeCells(parseCells(page))).toBe(page);
  });
});
