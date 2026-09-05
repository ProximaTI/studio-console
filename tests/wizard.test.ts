import { describe, it, expect } from 'vitest';
import { cteName, ctePrefix, buildVb, compileFromState, stateFromMeta } from '../web/src/wizard/vbState';
import { buildModel } from '../web/src/builder/infer';
import { findViewblocks, parseVbMeta, serializeVbMeta } from '../shared/viewblock.js';
import type { WizardState } from '../web/src/wizard/vbState';
import type { SourceInfo } from '../web/src/builder/types';

const INFO: SourceInfo = {
  name: 'apc_kpis',
  columns: [
    { name: 'unidade', type: 'VARCHAR' },
    { name: 'qtd', type: 'BIGINT' },
    { name: 'ano', type: 'BIGINT' },
  ],
};

const STATE: WizardState = {
  source: { kind: 'query', name: 'apc_kpis', ref: 'apc_kpis.sql', sql: 'select unidade, qtd, ano from comissoes;' },
  sourceInfo: INFO,
  sel: {
    groupBy: [{ table: 'apc_kpis', column: 'unidade' }],
    measures: [{ column: 'qtd', agg: 'sum' }],
    filters: [{ table: 'apc_kpis', column: 'ano', values: ['2025'] }],
    limit: 50,
  },
  params: [{ name: 'ano', type: 'enum', from: 'ano', default: '%', label: 'Ano' }],
  style: 'graph.bar',
};

describe('vbState (wizard puro)', () => {
  it('cteName sanitiza arquivo/id', () => {
    expect(cteName('apc_kpis.sql')).toBe('apc_kpis');
    expect(cteName('1-Consulta X.SQL')).toBe('q_1_consulta_x');
  });

  it('ctePrefix embrulha SQL de query/model e é vazio para fonte de arquivo', () => {
    expect(ctePrefix({ kind: 'source', name: 'comissoes' })).toBe('');
    const p = ctePrefix(STATE.source);
    expect(p).toContain('with "apc_kpis" as (');
    expect(p).not.toContain(';'); // ; final removido
  });

  it('buildVb preserva filtros/limite no marcador e mantém id na reedição', () => {
    const vb = buildVb(STATE);
    expect(vb.filters).toEqual(STATE.sel.filters);
    expect(vb.limit).toBe(50);
    expect(vb.source).toEqual({ kind: 'query', name: 'apc_kpis', ref: 'apc_kpis.sql' });
    const again = buildVb({ ...STATE, vbId: 'vb_fixado' });
    expect(again.id).toBe('vb_fixado');
    expect(buildVb(STATE).id).toBe(vb.id); // determinístico
  });

  it('compileFromState gera bloco com CTE em TODAS as queries (main + opts)', () => {
    const model = buildModel([INFO], 'apc_kpis')!;
    const block = compileFromState(STATE, model);
    const vbs = findViewblocks('# T\n\n' + block + '\n');
    expect(vbs).toHaveLength(1);
    // CTE no SQL principal e na query de opções do param
    const ctes = block.match(/with "apc_kpis" as \(/g) || [];
    expect(ctes.length).toBe(2);
    expect(block).toContain("like '${inputs.ano.value}'");
    expect(block).toContain('<BarChart data={');
    // filtro do funil também entra no SQL (valor numérico sai sem aspas)
    expect(block).toContain('= 2025');
  });

  it('stateFromMeta reconstrói seleção completa (round-trip do estado)', () => {
    const vb = buildVb(STATE);
    const meta = parseVbMeta(serializeVbMeta(vb));
    const st = stateFromMeta(meta);
    expect(st.sel.groupBy).toEqual(STATE.sel.groupBy);
    expect(st.sel.measures).toEqual(STATE.sel.measures);
    expect(st.sel.filters).toEqual(STATE.sel.filters);
    expect(st.sel.limit).toBe(50);
    expect(st.params).toEqual(STATE.params);
    expect(st.style).toBe('graph.bar');
    expect(st.source.ref).toBe('apc_kpis.sql');
    expect(st.vbId).toBe(vb.id);
  });

  it('troca de estilo preserva SQL: só a tag muda (spec §7.5)', () => {
    const model = buildModel([INFO], 'apc_kpis')!;
    const bar = compileFromState(STATE, model);
    const tab = compileFromState({ ...STATE, vbId: buildVb(STATE).id, style: 'tabular' }, model);
    const sqlOf = (s: string) => (s.match(/```sql[\s\S]*?```/g) || []).join('\n');
    expect(sqlOf(tab)).toBe(sqlOf(bar)); // células SQL idênticas
    expect(bar).toContain('<BarChart');
    expect(tab).toContain('<DataTable');
    expect(tab).not.toContain('<BarChart');
  });
});
