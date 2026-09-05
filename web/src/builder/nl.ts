// "✨ Montar consulta": texto livre -> Selections via Claude API (no servidor).
// O servidor guarda a chave; aqui só enviamos o texto + resumo do modelo e
// validamos a resposta contra o modelo (nada de tabela/coluna inventada).

import { jget, jpost } from '../api';
import { modelSummary } from './infer';
import type { Agg, BuilderModel, Selections } from './types';

export async function aiStatus(): Promise<{ enabled: boolean; model?: string }> {
  try {
    return await jget('/ai/status');
  } catch {
    return { enabled: false };
  }
}

const AGGS: Agg[] = ['sum', 'avg', 'count', 'min', 'max'];

/** Chama a API e devolve seleções VALIDADAS + nota do modelo (ou erro legível). */
export async function montarConsulta(
  text: string,
  model: BuilderModel,
  limit: number
): Promise<{ sel?: Selections; note?: string; error?: string }> {
  const r = await jpost('/ai/nl-query', { text, schema: modelSummary(model) });
  if (r.error) return { error: r.error };

  const tables = new Map<string, Set<string>>();
  tables.set(model.fact.name, new Set(model.fact.columns.map((c) => c.name)));
  for (const rel of model.related) tables.set(rel.table, new Set(rel.attrs.map((c) => c.name)));
  const measureCols = new Set(model.measures.map((c) => c.name));

  const sel: Selections = { groupBy: [], measures: [], filters: [], limit };
  for (const g of r.groupBy || []) {
    if (tables.get(g.table)?.has(g.column)) sel.groupBy.push({ table: g.table, column: g.column });
  }
  for (const m of r.measures || []) {
    if (measureCols.has(m.column) && AGGS.includes(m.agg)) sel.measures.push({ column: m.column, agg: m.agg });
  }
  for (const f of r.filters || []) {
    const cols = tables.get(f.table);
    // filtros podem mirar qualquer coluna existente da tabela (inclusive numéricas do fato)
    const ok =
      cols?.has(f.column) ||
      (f.table === model.fact.name && model.fact.columns.some((c) => c.name === f.column));
    if (ok && Array.isArray(f.values) && f.values.length) {
      sel.filters.push({ table: f.table, column: f.column, values: f.values.map(String) });
    }
  }
  return { sel, note: r.note || undefined };
}
