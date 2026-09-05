// Lógica PURA do wizard (sem React): estado ↔ marcador viewblock, CTE de
// fontes query/model, fonte SEMÂNTICA (F3) e montagem via compilador.
import { compileViewblock } from '../../../shared/viewStyles.js';
import { compileSemanticBlock } from '../../../shared/reportCompiler.js';
import { buildSql } from '../builder/sqlgen';
import type { BuilderModel, Selections, SourceInfo, VbParam } from '../builder/types';

/** Seleção sobre o catálogo (fonte semântica): nomes, não colunas. */
export type CatSel = { metrics: string[]; dims: { dim: string; level?: string }[] };

export type WizardSource = {
  kind: 'source' | 'query' | 'model' | 'semantic';
  /** Nome SQL da fonte (vira o nome do CTE para query/model). */
  name: string;
  /** Referência de origem p/ reedição: arquivo .sql (query) ou id (model). */
  ref?: string;
  /** SQL da fonte (apenas kind query/model — embrulhado em CTE). */
  sql?: string;
};

export type WizardState = {
  source: WizardSource;
  sourceInfo: SourceInfo;
  sel: Selections;
  params: VbParam[];
  style: string;
  /** Papel→coluna dos estilos com papéis (ConnectionMap/CollaborationGraph). */
  roles?: Record<string, string>;
  /** Config do estilo pivot: {rows, cols, measure, frozenCols, others}. */
  pivot?: { rows: string[]; cols: string; measure: { column: string; agg: string }; frozenCols: string[]; others: boolean } | null;
  /** Config do estilo nested: {parent, child, childStyle, limitPerGroup, maxGroups}. */
  nested?: any;
  /** Reedição: id do bloco existente (mantido); geração: novo id. */
  vbId?: string;
};

const q = (id: string) => '"' + id.replace(/"/g, '') + '"';

/** Nome de CTE seguro a partir de um arquivo/id (apc_kpis.sql → apc_kpis). */
export function cteName(ref: string): string {
  let n = ref.replace(/\.sql$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (/^[0-9]/.test(n)) n = 'q_' + n;
  return n;
}

/** Prefixo CTE (vazio para fonte de arquivo — a view já existe no schema). */
export function ctePrefix(source: WizardSource): string {
  if (source.kind === 'source' || !source.sql) return '';
  return `with ${q(source.name)} as (\n${source.sql.trim().replace(/;\s*$/, '')}\n)\n`;
}

function hash6(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(6, '0').slice(-6);
}

/** Monta o objeto vb (marcador) a partir do estado do wizard. */
export function buildVb(state: WizardState) {
  const id = state.vbId || 'vb_' + hash6(JSON.stringify([state.source, state.sel.groupBy, state.sel.measures, state.params, state.style]));
  return {
    v: 1,
    id,
    source: { kind: state.source.kind, name: state.source.name, ...(state.source.ref ? { ref: state.source.ref } : {}) },
    queries: [{ name: id, sql: null }],
    dims: state.sel.groupBy,
    metrics: state.sel.measures,
    // filters/limit não estão no schema mínimo §4, mas o parser preserva chaves
    // extras — sem eles a reedição perderia parte da seleção (spec §7.5).
    filters: state.sel.filters,
    limit: state.sel.limit,
    params: state.params,
    style: state.style,
    ...(state.roles && Object.keys(state.roles).length ? { roles: state.roles } : {}),
    ...(state.pivot ? { pivot: state.pivot } : {}),
    ...(state.nested ? { nested: state.nested } : {}),
    children: [],
  };
}

/** Compila o bloco completo (marcador + inputs + sql + tag + fechamento). */
export function compileFromState(state: WizardState, model: BuilderModel): string {
  const vb = buildVb(state);
  const prefix = ctePrefix(state.source);
  const baseSql = prefix + buildSql(model, state.sel, state.params);
  return compileViewblock(vb, { vb, source: state.sourceInfo, baseSql, ctePrefix: prefix });
}

/**
 * Fonte SEMÂNTICA: compila o bloco a partir da seleção de catálogo.
 * F5 (M28): DELEGA ao compilador compartilhado — o web não tem uma segunda
 * regra de geração; server e wizard produzem bytes idênticos.
 */
export function compileSemanticFromState(
  state: { source: WizardSource; sourceInfo: SourceInfo; catSel: CatSel; params: VbParam[]; style: string; filters?: any[]; roles?: Record<string, string>; pivot?: any; nested?: any; limit?: number; vbId?: string },
  catalog: any,
  hash: string
): string {
  return compileSemanticBlock({
    catalog,
    hash,
    sourceInfo: state.sourceInfo,
    catSel: state.catSel,
    filters: state.filters || [],
    params: state.params,
    style: state.style,
    roles: state.roles,
    pivot: state.pivot,
    nested: state.nested,
    limit: state.limit,
    vbId: state.vbId,
    ref: state.source.ref,
  });
}

/**
 * Recompila um bloco SEMÂNTICO direto do meta do marcador (drill F4 G e
 * regravações fora do wizard): mesmo caminho determinístico do wizard.
 */
export function recompileSemanticVb(meta: any, catalog: any, hash: string, sourceInfo: SourceInfo): string {
  return compileSemanticFromState(
    {
      source: { kind: 'semantic', name: catalog.model, ref: meta.source?.ref },
      sourceInfo,
      catSel: catSelFromMeta(meta),
      filters: meta.filters || [],
      params: meta.params || [],
      style: meta.style || 'tabular',
      roles: meta.roles,
      pivot: meta.pivot,
      nested: meta.nested,
      limit: meta.limit,
      vbId: meta.id,
    },
    catalog,
    hash
  );
}

/** Reconstrói o estado do wizard a partir do meta de um marcador existente. */
export function stateFromMeta(meta: any): Omit<WizardState, 'sourceInfo'> {
  return {
    source: { kind: meta.source?.kind || 'source', name: meta.source?.name || '', ref: meta.source?.ref },
    sel: {
      groupBy: meta.dims || [],
      measures: meta.metrics || [],
      filters: meta.filters || [],
      limit: Number(meta.limit) || 100,
    },
    params: meta.params || [],
    style: meta.style || 'tabular',
    roles: meta.roles || {},
    pivot: meta.pivot || null,
    nested: meta.nested || null,
    vbId: meta.id,
  };
}

/** Seleção de catálogo a partir do meta (reedição de bloco semântico). */
export function catSelFromMeta(meta: any): CatSel {
  return {
    metrics: (meta.metrics || []).map((m: any) => m.name).filter(Boolean),
    dims: (meta.dims || []).map((d: any) => ({ dim: d.dim, ...(d.level ? { level: d.level } : {}) })).filter((d: any) => d.dim),
  };
}
