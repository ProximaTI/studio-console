// Auto-inferência do modelo do builder a partir do information_schema
// (GET /api/connectors). Sem modelo semântico persistido: o usuário escolhe a
// tabela-FATO e as dimensões relacionadas são deduzidas por convenção de nomes.

import type { BuilderModel, Col, JoinEdge, RelatedDim, SourceInfo } from './types';

const NUM_RE = /INT|DOUBLE|FLOAT|REAL|DECIMAL/i;
const KEY_RE = /(_id|_code|_key)$|^id$|Id$/;
const YEAR_RE = /(^|_)(ano|year)$/i;

export const isNumeric = (c: Col) => NUM_RE.test(c.type);
export const isKey = (c: Col) => KEY_RE.test(c.name);
export const isYear = (c: Col) => YEAR_RE.test(c.name);

const MAX_DIMS = 6;

/** Monta o modelo do canvas: fato + medidas + atributos + dimensões inferidas. */
export function buildModel(sources: SourceInfo[], factName: string): BuilderModel | null {
  const fact = sources.find((s) => s.name === factName);
  if (!fact) return null;

  const measures = fact.columns.filter((c) => isNumeric(c) && !isKey(c) && !isYear(c));
  const factAttrs = fact.columns.filter((c) => !isNumeric(c) || isYear(c));

  const factKeys = fact.columns.filter((c) => isKey(c));
  const factYear = fact.columns.find((c) => isYear(c));

  const related: RelatedDim[] = [];
  for (const t of sources) {
    if (t.name === factName) continue;

    const on: JoinEdge['on'] = [];

    // Regra B (principal): colunas-CHAVE com o MESMO nome nas duas tabelas.
    for (const k of factKeys) {
      if (t.columns.some((c) => c.name === k.name)) on.push({ factCol: k.name, dimCol: k.name });
    }
    const sharedKeys = on.length;

    // Regra A: convenção FK — fato tem x_id/xId e existe tabela x/xs com id/x_id.
    if (sharedKeys === 0) {
      for (const k of factKeys) {
        const base = k.name.replace(/(_id|Id)$/, '').toLowerCase();
        if (!base) continue;
        if (t.name.toLowerCase() === base || t.name.toLowerCase() === base + 's') {
          const target = t.columns.find((c) => c.name === 'id') || t.columns.find((c) => c.name === k.name);
          if (target) on.push({ factCol: k.name, dimCol: target.name });
        }
      }
    }
    if (on.length === 0) continue;

    // Ano entra no join quando AMBAS têm coluna de ano (preserva o grão das agg_* anuais).
    const dimYear = t.columns.find((c) => isYear(c));
    if (factYear && dimYear) on.push({ factCol: factYear.name, dimCol: dimYear.name });

    const joinCols = new Set(on.map((j) => j.dimCol));
    const attrs = t.columns.filter((c) => !isNumeric(c) && !joinCols.has(c.name));
    if (attrs.length === 0) continue; // dimensão sem atributo exibível não agrega nada

    related.push({
      table: t.name,
      join: { dimTable: t.name, on },
      attrs,
      score: 10 * sharedKeys + attrs.length,
    });
  }

  related.sort((a, b) => b.score - a.score || (a.table < b.table ? -1 : 1));
  return { fact: { name: fact.name, columns: fact.columns }, measures, factAttrs, related: related.slice(0, MAX_DIMS) };
}

/** Resumo compacto do modelo (enviado à Claude API no ✨ Montar consulta). */
export function modelSummary(model: BuilderModel) {
  return {
    fact: {
      table: model.fact.name,
      measures: model.measures.map((c) => c.name),
      attributes: model.factAttrs.map((c) => c.name),
    },
    dimensions: model.related.map((r) => ({
      table: r.table,
      join: r.join.on.map((j) => j.factCol),
      attributes: r.attrs.map((c) => c.name),
    })),
  };
}
