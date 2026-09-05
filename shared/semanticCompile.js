// Compilador seleção→SQL SOBRE O CATÁLOGO (F3 Peça B, spec §4).
// Entrada: { catalog, hash, metrics: [nome], dims: [{dim, level?}], filters,
// params, limit } — saída: SQL DETERMINÍSTICO (mesma entrada ⇒ byte-idêntico).
// total() (§3.3): janela sobre a base agregada PÓS-filtros; scope:all = sub-
// query sem filtro nenhum (universo). Joins: só os declarados no modelo.
import { parseDerived } from './semanticCatalog.js';
import { paramPredicate } from './viewStyles.js';
import { escapeSqlValue } from './templating.js';

const q = (id) => '"' + String(id).replace(/"/g, '') + '"';
// Literal de filtro: respeita o TIPO do plano em vez de adivinhar pelo texto.
// Adivinhar quebrava dimensão VARCHAR com valores numéricos ("2023" ao lado de
// "trienio"): o literal saía sem aspas e o banco tentava converter a coluna
// inteira para inteiro. Número no plano ⇒ literal numérico; texto ⇒ string
// (o banco converte a string quando a coluna é numérica).
const valueSql = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : "'" + escapeSqlValue(v) + "'");

// Derivações de nível temporal quando a coluna do nível NÃO existe no fato.
const LEVEL_EXPR = {
  ano: (col) => `year(cast(${col} as date))`,
  year: (col) => `year(cast(${col} as date))`,
  trimestre: (col) => `'T' || quarter(cast(${col} as date))`,
  quarter: (col) => `'T' || quarter(cast(${col} as date))`,
  mes: (col) => `month(cast(${col} as date))`,
  month: (col) => `month(cast(${col} as date))`,
  dia: (col) => `day(cast(${col} as date))`,
  day: (col) => `day(cast(${col} as date))`,
};

function fail(msg) {
  throw new Error(msg);
}

function dimOf(catalog, name) {
  const d = (catalog.dimensions || {})[name];
  if (!d) fail(`dimensão "${name}" não existe no modelo ${catalog.model}`);
  return d;
}

function metricOf(catalog, name) {
  const m = (catalog.metrics || {})[name];
  if (!m) fail(`métrica "${name}" não existe no modelo ${catalog.model}`);
  return m;
}

/** Join declarado que liga o fato à tabela — senão a dimensão é inalcançável. */
function joinFor(catalog, table) {
  const j = (catalog.joins || []).find((x) => String(x.right).split('.')[0] === table || String(x.left).split('.')[0] === table);
  if (!j) fail(`dimensão em "${table}" não é alcançável a partir de ${catalog.fact} — declare o join no modelo`);
  return j;
}

/**
 * Colunas selecionadas de uma dimensão (+ tabela de join, se houver).
 * Retorna { cols: [{ expr, alias }], joinTable? }.
 * `level` escolhe o nível da hierarquia (coluna do fato se existir, senão derivada).
 */
function dimSelect(catalog, sel, factColumns) {
  const d = dimOf(catalog, sel.dim);
  // F4 frente C: dimensões calculadas — CASE determinístico, alias = nome da dim.
  if (d.bins || d.map) {
    if (sel.level) fail(`dimensão calculada "${sel.dim}" (bins/map) não tem níveis`);
    if (d.bins) {
      const col = q(d.bins.column);
      const { edges, labels } = d.bins;
      const parts = [];
      for (let i = 0; i < edges.length - 1; i++)
        parts.push(`when ${col} >= ${edges[i]} and ${col} < ${edges[i + 1]} then '${escapeSqlValue(labels[i])}'`);
      parts.push(`when ${col} >= ${edges[edges.length - 1]} then '${escapeSqlValue(labels[labels.length - 1])}'`);
      return { cols: [{ expr: `case ${parts.join(' ')} end`, alias: sel.dim }] };
    }
    const col = q(d.map.column);
    const whens = Object.entries(d.map.values).map(
      ([v, label]) => `when cast(${col} as varchar) = '${escapeSqlValue(v)}' then '${escapeSqlValue(label)}'`
    );
    const elseSql = d.map.else !== undefined ? ` else '${escapeSqlValue(d.map.else)}'` : '';
    return { cols: [{ expr: `case ${whens.join(' ')}${elseSql} end`, alias: sel.dim }] };
  }
  if (sel.level) {
    if (!Array.isArray(d.hierarchy) || !d.hierarchy.includes(sel.level))
      fail(`nível "${sel.level}" não existe na hierarquia de "${sel.dim}"`);
    if ((factColumns || []).includes(sel.level)) return { cols: [{ expr: q(sel.level), alias: sel.level }] };
    const mk = LEVEL_EXPR[sel.level];
    if (!mk) fail(`nível "${sel.level}" sem derivação conhecida — crie a coluna na fonte ou use ano/trimestre/mes/dia`);
    return { cols: [{ expr: mk(q(d.column)), alias: sel.level }] };
  }
  const columns = d.columns || [d.column];
  let joinTable;
  const cols = columns.map((c) => {
    if (String(c).includes('.')) {
      const [t, col] = String(c).split('.');
      joinFor(catalog, t);
      joinTable = t;
      return { expr: q(t) + '.' + q(col), alias: col };
    }
    return { expr: q(c), alias: c };
  });
  return { cols, joinTable };
}

/** Expressão SQL (sobre o fato) da coluna principal da dimensão/nível. */
export function dimExprOf(catalog, sel, factColumns) {
  return dimSelect(catalog, sel, factColumns).cols[0].expr;
}

/** Alias "principal" da dimensão (p/ x= dos estilos): nível > key > coluna única. */
export function dimAliasOf(catalog, sel) {
  if (sel.level) return sel.level;
  const d = dimOf(catalog, sel.dim);
  if (d.bins || d.map) return sel.dim; // calculada: o alias é o próprio nome
  const key = d.key || d.column || (d.columns || [])[0];
  return String(key).split('.').pop();
}

// F4 frente A: métrica com `filters` embutidos compila para agregação
// CONDICIONAL na base (um scan só) — count(distinct case...) / sum(case...).
const baseAggExpr = (m, condPred) => {
  const arg = condPred ? `case when ${condPred} then ${q(m.column)} end` : q(m.column);
  return m.agg === 'count_distinct' ? `count(distinct ${arg})` : `${m.agg}(${arg})`;
};

/** Info de exibição de uma métrica (label/fmt/alias) para os estilos. */
export function metricInfo(catalog, name) {
  const m = metricOf(catalog, name);
  return { name, alias: name, label: m.label || name, fmt: m.fmt };
}

/**
 * Compila a seleção sobre o catálogo. Determinístico por construção.
 * @param {{catalog, hash?, metrics: string[], dims?: {dim,level?}[],
 *          filters?: {dim, level?, values: string[]}[], params?: VbParam[],
 *          limit?: number, factColumns?: string[]}} input
 */
export function compileCatalogSql(input) {
  const { catalog, hash, factColumns } = input;
  const metrics = input.metrics || [];
  const dims = input.dims || [];
  const filters = input.filters || [];
  const params = input.params || [];
  if (!metrics.length && !dims.length) fail('selecione ao menos uma métrica ou dimensão do catálogo');

  // resolve dimensões (colunas + joins necessários)
  const dimCols = [];
  const joinTables = new Set();
  for (const s of dims) {
    const r = dimSelect(catalog, s, factColumns);
    dimCols.push(...r.cols);
    if (r.joinTable) joinTables.add(r.joinTable);
  }

  // métricas base necessárias: selecionadas + referenciadas pelos derived
  const baseNames = Object.entries(catalog.metrics || {}).filter(([, m]) => !m.derived).map(([n]) => n);
  const needed = new Set();
  const derivedSel = [];
  for (const name of metrics) {
    const m = metricOf(catalog, name);
    if (!m.derived) {
      needed.add(name);
      continue;
    }
    const r = parseDerived(m.derived, new Set(baseNames));
    if (!r.ok) fail(`metrics.${name}.derived: ${r.error}`);
    for (const t of r.tokens) {
      if (t.type === 'metric' || t.type === 'lag' || t.type === 'acum' || t.type === 'movel') needed.add(t.name);
      if (t.type === 'total' && t.scope === 'filtered') needed.add(t.name);
    }
    derivedSel.push({ name, tokens: r.tokens });
  }
  const neededOrdered = baseNames.filter((n) => needed.has(n)); // ordem do catálogo = determinística

  // predicados de uma lista de filtros {dim, level?, values[]} (seleção OU métrica)
  const predsOf = (flist) => {
    const conds = [];
    for (const f of flist || []) {
      const expr = dimSelect(catalog, f, factColumns).cols[0].expr;
      const vals = f.values || [];
      if (!vals.length) continue;
      conds.push(vals.length === 1 ? `${expr} = ${valueSql(vals[0])}` : `${expr} in (${vals.map(valueSql).join(', ')})`);
    }
    return conds;
  };
  const metricPred = (m) => predsOf(m.filters).join(' and ');

  // joins alcançados também pelos FILTROS das métricas necessárias (frente A)
  for (const n of neededOrdered) {
    for (const f of metricOf(catalog, n).filters || []) {
      const r = dimSelect(catalog, f, factColumns);
      if (r.joinTable) joinTables.add(r.joinTable);
    }
  }

  // GUARDAS (F4 frente D) — resultado errado silencioso vira erro educativo.
  // 1) fan-out: join declarado one_to_many multiplica linhas do fato — métrica
  //    aditiva (sum/avg/count) dobraria sem aviso; count_distinct sobrevive.
  const ADDITIVE = new Set(['sum', 'avg', 'count']);
  for (const t of [...joinTables]) {
    const j = joinFor(catalog, t);
    if (j.cardinality !== 'one_to_many') continue;
    const vitimas = neededOrdered.filter((n) => ADDITIVE.has(metricOf(catalog, n).agg));
    if (vitimas.length)
      fail(
        `risco de duplicação por fan-out: o join com "${t}" é one_to_many e ` +
          `${vitimas.map((v) => `"${v}"`).join(', ')} soma linhas multiplicadas — ` +
          `use count_distinct sobre a chave ou pré-agregue "${t}" na fonte`
      );
  }
  // 2) semi-aditiva: colapsar a dimensão `over` (ex.: somar saldo ao longo do
  //    tempo) é erro; incluir o nível temporal na seleção resolve.
  for (const n of neededOrdered) {
    const sa = metricOf(catalog, n).semi_additive;
    if (sa && !dims.some((s) => s.dim === sa.over))
      fail(
        `"${n}" não soma ao longo de "${sa.over}" (medida semi-aditiva) — ` +
          `inclua "${sa.over}" (ou um nível dela) na seleção; take: ${sa.take} compilado é P2`
      );
  }

  // where: filtros de dimensão + argumentos declarados (predicado por tipo)
  const where = [...predsOf(filters)];
  for (const p of params) {
    const [dimName, level] = String(p.from).split('.');
    const expr = dimSelect(catalog, { dim: dimName, level }, factColumns).cols[0].expr;
    where.push(paramPredicate(p, expr));
  }

  // joins declarados (apenas os alcançados pelas dimensões usadas)
  const joins = [];
  for (const t of [...joinTables]) {
    const j = joinFor(catalog, t);
    const [lt, lc] = String(j.left).split('.');
    const [rt, rc] = String(j.right).split('.');
    joins.push(`${j.type === 'inner' ? 'inner' : 'left'} join ${q(rt === t ? rt : lt)} on ${q(lt)}.${q(lc)} = ${q(rt)}.${q(rc)}`);
  }

  const header = `-- semantic: ${catalog.model}@${hash || 'dev'}`;
  const baseLines = [
    'select ' +
      [
        ...dimCols.map((c) => (c.expr === q(c.alias) ? c.expr : `${c.expr} as ${q(c.alias)}`)),
        ...neededOrdered.map((n) => {
          const m = metricOf(catalog, n);
          return `${baseAggExpr(m, metricPred(m))} as ${q(n)}`;
        }),
      ].join(', '),
    `from ${q(catalog.fact)}`,
    ...joins,
  ];
  if (where.length) baseLines.push('where ' + where.join('\n  and '));
  if (dimCols.length) baseLines.push('group by ' + dimCols.map((_, i) => i + 1).join(', '));

  // total(m, scope: all): subquery SEM filtro de seleção (universo) — o filtro
  // EMBUTIDO da métrica permanece (faz parte da definição dela).
  const totalAll = (name) => {
    const m = metricOf(catalog, name);
    return `(select ${baseAggExpr(m, metricPred(m))} from ${q(catalog.fact)}${joins.length ? ' ' + joins.join(' ') : ''})`;
  };

  // ---- janelas TEMPORAIS (F4 frente B) sobre a base agregada -------------
  // aliases produzidos por cada seleção de dimensão (para partition-by "das outras")
  const aliasesBySel = dims.map((s) => dimSelect(catalog, s, factColumns).cols.map((c) => c.alias));
  const aliasesExceptDim = (dimName) =>
    dims.flatMap((s, i) => (s.dim === dimName ? [] : aliasesBySel[i]));
  const overClause = (partitionAliases, orderAlias, frame) => {
    const parts = [];
    if (partitionAliases.length) parts.push(`partition by ${partitionAliases.map(q).join(', ')}`);
    parts.push(`order by ${q(orderAlias)}`);
    if (frame) parts.push(frame);
    return parts.join(' ');
  };
  // lag(m, n, nivel): valor há n períodos — exige o NÍVEL na seleção; janela
  // particiona pelas demais dims (YoY por editor quando editor está selecionado).
  const lagExpr = (t, metricName) => {
    const owner = dims.find((s) => s.level === t.level);
    if (!owner) fail(`"${metricName}" exige a dimensão de tempo (nível ${t.level}) na seleção`);
    return `lag(${q(t.name)}, ${t.n}) over (${overClause(aliasesExceptDim(owner.dim), t.level)})`;
  };
  // acum(m, nivel): com um nível MAIS FINO do mesmo dim selecionado, acumula
  // dentro do período-pai (ano ⇒ YTD); só com o próprio nível, acumula ao
  // longo dele. Ambos documentados.
  const acumExpr = (t, metricName) => {
    const parent = dims.find((s) => s.level === t.level);
    if (!parent) fail(`"${metricName}" (acum) exige o nível ${t.level} na seleção`);
    const hier = dimOf(catalog, parent.dim).hierarchy || [];
    const finer = dims.find((s) => s.dim === parent.dim && s.level && hier.indexOf(s.level) > hier.indexOf(t.level));
    const frame = 'rows unbounded preceding';
    if (finer) return `sum(${q(t.name)}) over (${overClause([...aliasesExceptDim(parent.dim), t.level], finer.level, frame)})`;
    return `sum(${q(t.name)}) over (${overClause(aliasesExceptDim(parent.dim), t.level, frame)})`;
  };
  // movel(m, n): média móvel de n períodos sobre o nível temporal MAIS FINO selecionado.
  const movelExpr = (t, metricName) => {
    const temporais = dims.filter((s) => s.level);
    if (!temporais.length) fail(`"${metricName}" (movel) exige um nível temporal na seleção`);
    const D = temporais[0].dim;
    const hier = dimOf(catalog, D).hierarchy || [];
    const doDim = temporais.filter((s) => s.dim === D);
    const finest = doDim.reduce((a, b) => (hier.indexOf(b.level) > hier.indexOf(a.level) ? b : a));
    const coarser = doDim.filter((s) => s !== finest).map((s) => s.level);
    return `avg(${q(t.name)}) over (${overClause([...aliasesExceptDim(D), ...coarser], finest.level, `rows ${t.n - 1} preceding`)})`;
  };

  const derivedExpr = (tokens, metricName) =>
    tokens
      .map((t) => {
        if (t.type === 'metric') return q(t.name);
        if (t.type === 'num') return t.value;
        if (t.type === 'op') return t.value;
        if (t.type === 'lag') return lagExpr(t, metricName);
        if (t.type === 'acum') return acumExpr(t, metricName);
        if (t.type === 'movel') return movelExpr(t, metricName);
        return t.scope === 'all' ? totalAll(t.name) : `sum(${q(t.name)}) over ()`;
      })
      .join(' ');

  const outer = [
    ...dimCols.map((c) => q(c.alias)),
    ...metrics.map((name) => {
      const d = derivedSel.find((x) => x.name === name);
      return d ? `${derivedExpr(d.tokens, name)} as ${q(name)}` : q(name);
    }),
  ];

  const lines = [header, 'with base as (', ...baseLines.map((l) => '  ' + l), ')', 'select ' + outer.join(', '), 'from base'];
  if (metrics.length) lines.push(`order by ${q(metrics[0])} desc`);
  else lines.push('order by 1');
  const lim = Math.max(1, Number(input.limit) || 1000);
  lines.push(`limit ${lim}`);
  return lines.join('\n');
}
