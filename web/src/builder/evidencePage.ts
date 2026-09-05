// Gera o conteúdo .md (dialeto Evidence) a partir do SQL do builder.
// Com seleção válida, emite um VIEW BLOCK (spec §4) via compilador compartilhado
// — o bloco fica reeditável por passos no notebook. Sem contrato atendível
// (ex.: select * sem seleções), cai no md simples de antes.

import { compileViewblock } from '../../../shared/viewStyles.js';
import type { BuilderModel, Selections, VbParam } from './types';

export function defaultPageName(model: BuilderModel, sel: Selections): string {
  const dim = sel.groupBy[0]?.column;
  const base = dim ? `${model.fact.name}_por_${dim}` : model.fact.name;
  return base.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

// Hash determinístico (djb2) — id estável para o mesmo SQL+seleção (testável).
function hash6(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(6, '0').slice(-6);
}

/** Estilo default pela forma da seleção (a galeria do wizard refina depois). */
function defaultStyle(sel: Selections): string | null {
  const dims = sel.groupBy.length;
  const mets = sel.measures.length;
  if (dims === 1 && mets >= 1) return 'graph.bar';
  if (dims >= 2 && mets >= 1) return 'tabular';
  if (dims === 0 && mets >= 1) return 'freeform';
  return null; // sem contrato → página simples, sem View Block
}

export function buildEvidenceMd(sql: string, sel: Selections, model: BuilderModel, params: VbParam[] = []): string {
  const dim = sel.groupBy[0];
  const titulo = dim ? `${model.fact.name} por ${dim.column}` : `Consulta sobre ${model.fact.name}`;
  const head = `# ${titulo}\n\nPágina gerada pelo SQL Builder — reedite o bloco pelos passos do wizard ou desacople.\n\n`;

  const style = defaultStyle(sel);
  if (!style) {
    // fallback legado: exploração livre sem seleção estruturada
    return `# ${titulo}\n\nPágina gerada pelo SQL Builder — edite a query e os componentes à vontade.\n\n` +
      '```sql consulta\n' + sql.trim() + '\n```\n\n<DataTable data={consulta}/>\n';
  }

  const id = 'vb_' + hash6(sql + '|' + JSON.stringify([sel.groupBy, sel.measures, params]));
  const vb = {
    v: 1,
    id,
    source: { kind: 'source', name: model.fact.name },
    queries: [{ name: id, sql: null }],
    dims: sel.groupBy,
    metrics: sel.measures,
    params,
    style,
    children: [],
  };
  const block = compileViewblock(vb, { vb, source: model.fact, baseSql: sql });
  return head + block + '\n';
}
