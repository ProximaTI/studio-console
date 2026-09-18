// Compilador seleção→SQL SOBRE O CATÁLOGO (F3 Peça B, spec §4).
// Entrada: { catalog, hash, metrics: [nome], dims: [{dim, level?}], filters,
// params, limit } — saída: SQL DETERMINÍSTICO (mesma entrada ⇒ byte-idêntico).
// total() (§3.3): janela sobre a base agregada PÓS-filtros; scope:all = sub-
// query sem filtro nenhum (universo). Joins: só os declarados no modelo.
import { parseDerived, DISTRIBUTION_AGGS } from './semanticCatalog.js';
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

/** Predicados de uma lista de filtros {dim, level?, values[]} (seleção OU métrica). */
function predsOfWith(catalog, factColumns, flist, joinTables) {
  const conds = [];
  for (const f of flist || []) {
    const r = dimSelect(catalog, f, factColumns);
    if (joinTables && r.joinTable) joinTables.add(r.joinTable);
    const vals = f.values || [];
    if (!vals.length) continue;
    conds.push(vals.length === 1 ? `${r.cols[0].expr} = ${valueSql(vals[0])}` : `${r.cols[0].expr} in (${vals.map(valueSql).join(', ')})`);
  }
  return conds;
}

/** Cláusulas de join declaradas, na ordem das tabelas alcançadas. */
function joinClauses(catalog, joinTables) {
  const joins = [];
  for (const t of [...joinTables]) {
    const j = joinFor(catalog, t);
    const [lt, lc] = String(j.left).split('.');
    const [rt, rc] = String(j.right).split('.');
    joins.push(`${j.type === 'inner' ? 'inner' : 'left'} join ${q(rt === t ? rt : lt)} on ${q(lt)}.${q(lc)} = ${q(rt)}.${q(rc)}`);
  }
  return joins;
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
// Cada agregação declarada tem UMA expressão SQL — mapa fechado, não
// concatenação do nome. `p25/p75/p90/median` não existem como função com esse
// nome; são quantis contínuos.
const QUANTIS = { median: 0.5, p25: 0.25, p75: 0.75, p90: 0.9 };
const baseAggExpr = (m, condPred) => {
  const arg = condPred ? `case when ${condPred} then ${q(m.column)} end` : q(m.column);
  if (m.agg === 'count_distinct') return `count(distinct ${arg})`;
  if (m.agg === 'stddev') return `stddev_samp(${arg})`;
  if (m.agg in QUANTIS) return `quantile_cont(${arg}, ${QUANTIS[m.agg]})`;
  return `${m.agg}(${arg})`;
};

/**
 * A métrica é uma POSIÇÃO no ranking? Só o catálogo sabe — o viewblock carrega
 * apenas nome/alias/label/fmt. Usado por quem valida com o catálogo em mãos.
 */
export function isRankMetric(catalog, name) {
  const m = (catalog.metrics || {})[name];
  if (!m || !m.derived) return false;
  const base = new Set(Object.entries(catalog.metrics || {}).filter(([, x]) => !x.derived).map(([n]) => n));
  const r = parseDerived(m.derived, base);
  return r.ok && r.tokens.some((t) => t.type === 'posicao' || t.type === 'variacao_posicao');
}

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
      if (t.type === 'posicao' || t.type === 'variacao_posicao') needed.add(t.name);
      if (t.type === 'total' && t.scope === 'filtered') needed.add(t.name);
    }
    derivedSel.push({ name, tokens: r.tokens });
  }
  const neededOrdered = baseNames.filter((n) => needed.has(n)); // ordem do catálogo = determinística

  // predicados de uma lista de filtros {dim, level?, values[]} (seleção OU métrica)
  const predsOf = (flist) => predsOfWith(catalog, factColumns, flist, null);
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
  //    Estatística de DISTRIBUIÇÃO (mediana/quantil/desvio) também se corrompe,
  //    e de forma mais traiçoeira: a linha duplicada não infla um total visível,
  //    ela desloca o quantil em direção ao valor repetido.
  const ADDITIVE = new Set(['sum', 'avg', 'count', ...DISTRIBUTION_AGGS]);
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
  const joins = joinClauses(catalog, joinTables);

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

  // ---- RANKING ao longo do tempo (F4 frente F) ----------------------------
  // `lag(rank(...) over (...)) over (...)` é ILEGAL: "window function calls
  // cannot be nested". Logo a variação de posição NÃO cabe no select único
  // sobre `base` — ela precisa de um estágio a mais, onde a posição já seja
  // uma coluna comum que a segunda janela possa ler. A CTE `posicoes` não é
  // organização do código: é a única forma de expressar isso em SQL.
  const posAlias = (t) => `__pos_${t.name}_${t.level}`;
  const rankTokens = [];
  for (const d of derivedSel)
    for (const t of d.tokens)
      if (t.type === 'posicao' || t.type === 'variacao_posicao') {
        if (!dims.some((sel) => sel.level === t.level))
          fail(`"${d.name}" exige o nível ${t.level} na seleção — posição é posição DENTRO DE cada período`);
        if (!rankTokens.some((x) => posAlias(x) === posAlias(t))) rankTokens.push(t);
      }
  // rank() (e não row_number/dense_rank): empate divide a posição e o próximo
  // salta — a convenção de ranking, e a única que não inventa desempate.
  const rankSelect = (t) => `rank() over (partition by ${q(t.level)} order by ${q(t.name)} desc) as ${q(posAlias(t))}`;
  // Posição menor é melhor, então ANTERIOR − ATUAL > 0 significa que subiu.
  // Sem período anterior o lag é nulo: não há movimento a relatar, e inventar
  // zero diria "ficou parado".
  const variacaoExpr = (t) => {
    const owner = dims.find((sel) => sel.level === t.level);
    const a = q(posAlias(t));
    return `lag(${a}, 1) over (${overClause(aliasesExceptDim(owner.dim), t.level)}) - ${a}`;
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
        if (t.type === 'posicao') return q(posAlias(t));
        if (t.type === 'variacao_posicao') return variacaoExpr(t);
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

  const lines = [header, 'with base as (', ...baseLines.map((l) => '  ' + l), ')'];
  let origem = 'base';
  if (rankTokens.length) {
    const colunas = [...dimCols.map((c) => q(c.alias)), ...neededOrdered.map((n) => q(n))];
    lines.push(', posicoes as (', '  select ' + [...colunas, ...rankTokens.map(rankSelect)].join(', '), '  from base', ')');
    origem = 'posicoes';
  }
  lines.push('select ' + outer.join(', '), `from ${origem}`);
  // Corte do topo (D-R4): sem ele um bump de 486 entidades é um novelo. O
  // recorte é "esteve no top N em ALGUM período" — cortar período a período
  // faria linhas aparecerem e sumirem, que é o que um bump não pode fazer.
  const topo = Number(input.rankTop);
  if (rankTokens.length && Number.isInteger(topo) && topo > 0) {
    const t = rankTokens[0];
    const ent = dims.flatMap((sel, i) => (sel.level === t.level ? [] : aliasesBySel[i]));
    if (!ent.length) fail('rankTop precisa de uma dimensão além do nível temporal — é ela que é rankeada');
    const tupla = ent.map(q).join(', ');
    lines.push(`where (${tupla}) in (select ${tupla} from posicoes where ${q(posAlias(t))} <= ${topo})`);
  }
  if (metrics.length) lines.push(`order by ${q(metrics[0])} desc`);
  else lines.push('order by 1');
  const lim = Math.max(1, Number(input.limit) || 1000);
  lines.push(`limit ${lim}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// DISTRIBUIÇÃO (histograma) — a segunda forma de resposta.
// compileCatalogSql responde "uma linha agregada por categoria". Um histograma
// conta OBSERVAÇÕES por faixa, o que exige as linhas do fato ANTES do group by
// — por isso é outro construtor, e não um embrulho da base agregada.

export const MIN_BINS = 5;
export const MAX_BINS = 100;
const CLAMP_Q = 0.99;

/**
 * @param {{catalog, hash?, metric: string, bins: number,
 *          filters?: {dim, level?, values: string[]}[], params?: VbParam[],
 *          factColumns?: string[]}} input
 *
 * A métrica é um PONTEIRO para a coluna observada (D-H4): a agregação
 * declarada nela NÃO é usada — histograma conta linhas, não agrega. Os
 * `filters` embutidos da métrica continuam valendo: fazem parte da definição
 * dela, não do recorte.
 *
 * As bordas saem DENTRO da query (D-H2): o compilador continua puro e o SQL
 * byte-idêntico para a mesma entrada, sem ida extra ao banco.
 *
 * A borda superior é o p99, não o máximo (D-H5). Aparar NÃO é descartar: o
 * `least` joga o que passa do p99 na ÚLTIMA faixa, que sai aberta ("400+").
 * A contagem total continua sendo a das observações não-nulas — um histograma
 * que some com a cauda mentiria sobre o próprio N.
 */
export function compileDistributionSql(input) {
  const { catalog, hash, factColumns } = input;
  // Truncar 12.5 para 12 seria consertar a entrada em silêncio — o número de
  // faixas muda a forma que o leitor vê, então ele é declarado ou é erro.
  const N = Number(input.bins);
  if (!Number.isInteger(N) || N < MIN_BINS || N > MAX_BINS)
    fail(`distribution.bins deve ser um inteiro entre ${MIN_BINS} e ${MAX_BINS} (recebido: ${JSON.stringify(input.bins)})`);

  const m = metricOf(catalog, input.metric);
  if (m.derived)
    fail(
      `"${input.metric}" é derivada e não tem coluna — o histograma observa uma COLUNA do fato. ` +
        `Aponte uma métrica base (a agregação dela é ignorada; só a coluna importa).`
    );
  if (m.agg === 'count' || m.agg === 'count_distinct')
    fail(
      `"${input.metric}" CONTA ocorrências de "${m.column}" — o histograma precisa de uma medida numérica ` +
        `por linha (uma métrica sum/avg/min/max sobre a coluna a observar).`
    );

  const joinTables = new Set();
  const where = [`${q(m.column)} is not null`];
  where.push(...predsOfWith(catalog, factColumns, m.filters, joinTables));
  where.push(...predsOfWith(catalog, factColumns, input.filters, joinTables));
  for (const p of input.params || []) {
    const [dimName, level] = String(p.from).split('.');
    const r = dimSelect(catalog, { dim: dimName, level }, factColumns);
    if (r.joinTable) joinTables.add(r.joinTable);
    where.push(paramPredicate(p, r.cols[0].expr));
  }

  // Fan-out corrompe um histograma de forma ainda mais direta que uma soma: a
  // linha duplicada é uma observação inventada, e a forma da distribuição é o
  // produto inteiro aqui.
  for (const t of [...joinTables]) {
    if (joinFor(catalog, t).cardinality === 'one_to_many')
      fail(
        `risco de duplicação por fan-out: o join com "${t}" é one_to_many e cada linha do fato ` +
          `viraria várias observações — pré-agregue "${t}" na fonte`
      );
  }

  const joins = joinClauses(catalog, joinTables);
  const last = N - 1;
  const ini = `lim.lo + f.i * (lim.hi - lim.lo) / ${N}`;
  return [
    `-- semantic: ${catalog.model}@${hash || 'dev'} · distribuição (${N} faixas, cauda aparada no p99)`,
    'with obs as (',
    `  select ${q(m.column)} as v`,
    `  from ${q(catalog.fact)}`,
    ...joins.map((j) => '  ' + j),
    '  where ' + where.join('\n    and '),
    '), lim as (',
    `  select min(v) as lo, quantile_cont(v, ${CLAMP_Q}) as hi, max(v) as vmax, count(*) as n`,
    '  from obs',
    '), faixas as (',
    '  select',
    '    f.i,',
    `    ${ini} as ini,`,
    `    case when f.i = ${last} then lim.vmax else lim.lo + (f.i + 1) * (lim.hi - lim.lo) / ${N} end as fim,`,
    '    case when lim.hi - lim.lo >= 100 then cast(cast(round(ini, 0) as bigint) as varchar)',
    '         else cast(round(ini, 2) as varchar) end',
    `      || case when f.i = ${last} and lim.vmax > lim.hi then '+' else '' end as faixa`,
    `  from (select unnest(range(0, ${N})) as i) f, lim`,
    // n = 0 ⇒ nenhuma faixa (o bloco renderiza o vazio normal);
    // hi = lo (tudo igual) ⇒ uma faixa só, em vez de N rótulos idênticos.
    '  where lim.n > 0 and (f.i = 0 or lim.hi > lim.lo)',
    '), contagem as (',
    '  select',
    `    least(${last}, case when lim.hi > lim.lo`,
    `                        then cast(floor((obs.v - lim.lo) * ${N} / (lim.hi - lim.lo)) as integer)`,
    '                        else 0 end) as i,',
    '    count(*) as n',
    '  from obs, lim',
    '  group by 1',
    ')',
    'select f.i as faixa_i, f.ini as faixa_min, f.fim as faixa_max, f.faixa as faixa,',
    '  coalesce(c.n, 0) as observacoes',
    'from faixas f',
    'left join contagem c on c.i = f.i',
    'order by f.i',
  ].join('\n');
}
