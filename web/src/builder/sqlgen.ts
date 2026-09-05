// Geração DETERMINÍSTICA de SQL a partir das seleções do canvas.
// Nenhuma IA aqui: o SQL é função pura de (modelo, seleções).

import { escapeSqlValue } from '../../../shared/templating.js';
import { paramPredicate } from '../../../shared/viewStyles.js';
import type { BuilderModel, Selections, VbParam } from './types';

const q = (id: string) => '"' + id.replace(/"/g, '') + '"';

function valueSql(v: string) {
  return /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : "'" + escapeSqlValue(v) + "'";
}

/**
 * Monta o SQL: joins só das tabelas usadas, group by posicional, order by 1ª agg.
 * `params` (View Block, Passo 3): cada argumento enum vira um predicado
 * `cast(col as varchar) like '${inputs.<nome>.value}'` — com default "%" = Todos.
 */
export function buildSql(model: BuilderModel, sel: Selections, params: VbParam[] = []): string {
  if (!model) return '';
  const usedTables = new Set<string>();
  for (const g of sel.groupBy) usedTables.add(g.table);
  for (const f of sel.filters) usedTables.add(f.table);
  usedTables.delete(model.fact.name);

  // alias por tabela: f para o fato, d1..dN na ordem do modelo
  const alias = new Map<string, string>([[model.fact.name, 'f']]);
  const joins: string[] = [];
  model.related.forEach((r, i) => {
    if (!usedTables.has(r.table)) return;
    const a = 'd' + (i + 1);
    alias.set(r.table, a);
    const conds = r.join.on.map((j) => `f.${q(j.factCol)} = ${a}.${q(j.dimCol)}`).join(' and ');
    joins.push(`left join ${q(r.table)} ${a} on ${conds}`);
  });

  const col = (t: string, c: string) => `${alias.get(t) || 'f'}.${q(c)}`;

  // colunas de dimensão com alias legível (prefixa a tabela em caso de colisão)
  const seen = new Set<string>();
  const dimSelects = sel.groupBy.map((g) => {
    let out = g.column;
    if (seen.has(out)) out = `${g.table}_${g.column}`;
    seen.add(out);
    return out === g.column ? col(g.table, g.column) : `${col(g.table, g.column)} as ${q(out)}`;
  });

  const aggSelects = sel.measures.map((m) => {
    const expr = m.agg === 'count_distinct' ? `count(distinct f.${q(m.column)})` : `${m.agg}(f.${q(m.column)})`;
    return `${expr} as ${q(m.agg + '_' + m.column)}`;
  });

  const where = sel.filters
    .filter((f) => f.values.length > 0)
    .map((f) => {
      const c = col(f.table, f.column);
      return f.values.length === 1 ? `${c} = ${valueSql(f.values[0])}` : `${c} in (${f.values.map(valueSql).join(', ')})`;
    });
  // Predicados dos argumentos declarados (sempre no fato; tipo define o operador).
  for (const p of params) {
    where.push(paramPredicate(p, 'f.' + q(p.from)));
  }

  const lim = Math.max(1, Number(sel.limit) || 100);
  const lines: string[] = [];

  if (aggSelects.length === 0) {
    if (dimSelects.length === 0) {
      lines.push(`select * `, `from ${q(model.fact.name)} f`);
      if (joins.length) lines.push(...joins);
      if (where.length) lines.push('where ' + where.join('\n  and '));
      lines.push(`limit ${lim}`);
      return lines.join('\n');
    }
    lines.push('select distinct ' + dimSelects.join(', '), `from ${q(model.fact.name)} f`);
    if (joins.length) lines.push(...joins);
    if (where.length) lines.push('where ' + where.join('\n  and '));
    lines.push('order by 1', `limit ${lim}`);
    return lines.join('\n');
  }

  lines.push('select ' + [...dimSelects, ...aggSelects].join(', '), `from ${q(model.fact.name)} f`);
  if (joins.length) lines.push(...joins);
  if (where.length) lines.push('where ' + where.join('\n  and '));
  if (dimSelects.length) lines.push('group by ' + dimSelects.map((_, i) => i + 1).join(', '));
  lines.push(`order by ${dimSelects.length + 1} desc`, `limit ${lim}`);
  return lines.join('\n');
}
