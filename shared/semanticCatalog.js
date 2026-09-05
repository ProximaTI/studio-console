// Catálogo semântico (F3, spec §3): validação estruturada do objeto já
// parseado (o YAML é parseado SÓ no server — aqui trafega JSON). Erros em PT
// com caminho ("metrics.pct_apc.derived: ..."), no lugar de JSON Schema.

export const AGGS = new Set(['sum', 'avg', 'min', 'max', 'count', 'count_distinct']);

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const TABLE_COL = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i;

/**
 * Tokeniza uma expressão `derived` (spec §3.2 + F4 frente B): aritmética entre
 * métricas do modelo + total(m[, scope: all]) + vocabulário TEMPORAL fechado —
 * lag(m, n, nivel) · acum(m, nivel) · movel(m, n). Sem coluna crua, sem SQL.
 * Retorna { ok, tokens } ou { ok: false, error }.
 */
export function parseDerived(expr, metricNames) {
  const tokens = [];
  const src = String(expr || '');
  const re =
    /\s*(?:(?<total>total\s*\(\s*(?<tname>\w+)\s*(?<tscope>,\s*scope\s*:\s*all\s*)?\))|(?<lag>lag\s*\(\s*(?<lname>\w+)\s*,\s*(?<ln>\d+)\s*,\s*(?<llevel>\w+)\s*\))|(?<acum>acum\s*\(\s*(?<aname>\w+)\s*,\s*(?<alevel>\w+)\s*\))|(?<movel>movel\s*\(\s*(?<mname>\w+)\s*,\s*(?<mn>\d+)\s*\))|(?<num>\d+(?:\.\d+)?)|(?<ident>[A-Za-z_]\w*)|(?<op>[+\-*/()]))/y;
  const known = (fn, name) => (metricNames.has(name) ? null : { ok: false, error: `${fn}(${name}): métrica desconhecida` });
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) {
      if (!src.slice(i).trim()) break;
      return { ok: false, error: `trecho inválido a partir de "${src.slice(i).trim().slice(0, 20)}"` };
    }
    const g = m.groups;
    if (g.total) {
      const bad = known('total', g.tname);
      if (bad) return bad;
      tokens.push({ type: 'total', name: g.tname, scope: g.tscope ? 'all' : 'filtered' });
    } else if (g.lag) {
      const bad = known('lag', g.lname);
      if (bad) return bad;
      const n = Number(g.ln);
      if (!(n >= 1)) return { ok: false, error: `lag(${g.lname}, ${g.ln}, ...): n deve ser ≥ 1` };
      tokens.push({ type: 'lag', name: g.lname, n, level: g.llevel });
    } else if (g.acum) {
      const bad = known('acum', g.aname);
      if (bad) return bad;
      tokens.push({ type: 'acum', name: g.aname, level: g.alevel });
    } else if (g.movel) {
      const bad = known('movel', g.mname);
      if (bad) return bad;
      const n = Number(g.mn);
      if (!(n >= 2)) return { ok: false, error: `movel(${g.mname}, ${g.mn}): n deve ser ≥ 2` };
      tokens.push({ type: 'movel', name: g.mname, n });
    } else if (g.num) {
      tokens.push({ type: 'num', value: g.num });
    } else if (g.ident) {
      if (!metricNames.has(g.ident)) return { ok: false, error: `"${g.ident}" não é métrica do modelo (colunas cruas e funções SQL não entram em derived)` };
      tokens.push({ type: 'metric', name: g.ident });
    } else if (g.op) {
      tokens.push({ type: 'op', value: g.op });
    }
    i = re.lastIndex;
  }
  if (!tokens.length) return { ok: false, error: 'expressão vazia' };
  return { ok: true, tokens };
}

/** Distância de edição simples (Levenshtein) — sugestão de coluna próxima na validação profunda. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

export function nearestColumn(name, cols) {
  let best = null;
  let bestD = Infinity;
  for (const c of cols || []) {
    const dd = editDistance(String(name).toLowerCase(), String(c).toLowerCase());
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return bestD <= 3 ? best : null;
}

/** description/synonyms (F4 frente E): opcionais, ignorados pelo compilador, injetados no agente. */
function checkGrounding(err, path, obj) {
  if (obj.description !== undefined && typeof obj.description !== 'string') err(path + '.description', 'deve ser texto');
  if (obj.synonyms !== undefined && (!Array.isArray(obj.synonyms) || obj.synonyms.some((s) => typeof s !== 'string')))
    err(path + '.synonyms', 'deve ser lista de textos, ex.: [faturamento, gasto]');
}

/**
 * Valida o catálogo. Retorna [{ path, message }] — vazio = válido.
 * `factColumns` (F4 frente F, opcional): colunas REAIS do fato — com elas a
 * validação confere existência (métrica/dimensão/grain/join no fato) e sugere
 * a coluna mais próxima. Sem elas, degrada para a validação estrutural.
 */
export function validateCatalog(cat, factColumns) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!cat || typeof cat !== 'object') return [{ path: '', message: 'catálogo vazio ou inválido' }];
  const colSet = Array.isArray(factColumns) && factColumns.length ? new Set(factColumns.map(String)) : null;
  const checkCol = (path, col) => {
    if (!colSet || typeof col !== 'string' || col.includes('.') || col === '*') return; // qualificada = via join; valida só o fato
    if (!colSet.has(col)) {
      const near = nearestColumn(col, factColumns);
      err(path, `"${col}" não existe em ${cat.fact}${near ? ` — coluna próxima: ${near}` : ''}`);
    }
  };
  checkGrounding(err, 'model', cat);

  if (!cat.model || !IDENT.test(String(cat.model))) err('model', 'obrigatório (identificador, ex.: vendas)');
  if (!cat.fact || typeof cat.fact !== 'string') err('fact', 'obrigatório — fonte registrada no projeto');
  if (cat.grain !== undefined && !Array.isArray(cat.grain)) err('grain', 'deve ser lista de colunas');
  else for (const c of cat.grain || []) checkCol('grain', c);

  const dims = cat.dimensions || {};
  if (typeof dims !== 'object' || Array.isArray(dims)) err('dimensions', 'deve ser um mapa nome → definição');
  for (const [name, d] of Object.entries(dims)) {
    const p = 'dimensions.' + name;
    if (!IDENT.test(name)) err(p, 'nome inválido');
    if (!d || typeof d !== 'object') {
      err(p, 'definição deve ser objeto');
      continue;
    }
    checkGrounding(err, p, d);
    const hasCol = typeof d.column === 'string';
    const hasCols = Array.isArray(d.columns) && d.columns.length > 0;
    // F4 frente C: construtores fechados bins/map — sem CASE livre (expressão
    // arbitrária vai para a fonte).
    const hasBins = d.bins !== undefined;
    const hasMap = d.map !== undefined;
    if ([hasCol, hasCols, hasBins, hasMap].filter(Boolean).length !== 1)
      err(p, 'use column OU columns OU bins OU map (exatamente um)');
    if (hasCol) checkCol(p + '.column', d.column);
    if (hasCols) {
      for (const c of d.columns) checkCol(p + '.columns', c);
      if (!d.key) err(p + '.key', 'obrigatório quando há columns');
      else if (!d.columns.includes(d.key)) err(p + '.key', `"${d.key}" precisa estar em columns`);
    }
    if (hasBins) {
      const b = d.bins || {};
      if (typeof b.column !== 'string') err(p + '.bins.column', 'obrigatório');
      else checkCol(p + '.bins.column', b.column);
      const edgesOk = Array.isArray(b.edges) && b.edges.length >= 2 && b.edges.every((x) => typeof x === 'number');
      if (!edgesOk) err(p + '.bins.edges', 'lista crescente de números (≥2), ex.: [0, 1000, 5000]');
      else if (b.edges.some((x, i) => i > 0 && x <= b.edges[i - 1])) err(p + '.bins.edges', 'bordas devem ser estritamente crescentes');
      if (!Array.isArray(b.labels) || b.labels.length !== (b.edges || []).length)
        err(p + '.bins.labels', 'um rótulo por borda (o último = acima da última borda)');
    }
    if (hasMap) {
      const mp = d.map || {};
      if (typeof mp.column !== 'string') err(p + '.map.column', 'obrigatório');
      else checkCol(p + '.map.column', mp.column);
      if (!mp.values || typeof mp.values !== 'object' || Array.isArray(mp.values) || !Object.keys(mp.values).length)
        err(p + '.map.values', 'mapa valor → rótulo não-vazio');
      if (mp.else !== undefined && typeof mp.else !== 'string') err(p + '.map.else', 'deve ser texto');
    }
    if (d.hierarchy !== undefined) {
      if (hasBins || hasMap) err(p + '.hierarchy', 'dimensão calculada (bins/map) não tem níveis');
      else if (!Array.isArray(d.hierarchy) || d.hierarchy.some((h) => !IDENT.test(String(h))))
        err(p + '.hierarchy', 'lista de níveis (identificadores), ex.: [ano, trimestre, mes]');
    }
  }

  const mets = cat.metrics || {};
  if (typeof mets !== 'object' || Array.isArray(mets)) err('metrics', 'deve ser um mapa nome → definição');
  const baseNames = new Set(Object.entries(mets).filter(([, m]) => m && !m.derived).map(([n]) => n));
  for (const [name, m] of Object.entries(mets)) {
    const p = 'metrics.' + name;
    if (!IDENT.test(name)) err(p, 'nome inválido');
    if (!m || typeof m !== 'object') {
      err(p, 'definição deve ser objeto');
      continue;
    }
    const isBase = m.agg !== undefined || m.column !== undefined;
    const isDerived = m.derived !== undefined;
    if (isBase === isDerived) {
      err(p, 'use {agg, column} OU {derived} (exatamente um)');
      continue;
    }
    checkGrounding(err, p, m);
    // F4 frente A: filtro embutido na métrica — mesmo shape dos filtros de
    // seleção, referencia DIMENSÕES do modelo (nunca coluna crua).
    if (m.filters !== undefined) {
      if (isDerived) err(p + '.filters', 'filtro embutido só em métrica base — a derived herda pelos operandos');
      else if (!Array.isArray(m.filters)) err(p + '.filters', 'lista de {dim, level?, values[]}');
      else
        for (const [fi, f] of m.filters.entries()) {
          const fp = `${p}.filters[${fi}]`;
          if (!f || typeof f !== 'object' || !dims[f.dim]) err(fp + '.dim', `dimensão "${f?.dim}" não existe no modelo`);
          else if (f.level && !(dims[f.dim].hierarchy || []).includes(f.level))
            err(fp + '.level', `nível "${f.level}" não existe na hierarquia de "${f.dim}"`);
          if (!Array.isArray(f?.values) || !f.values.length) err(fp + '.values', 'lista não-vazia de valores');
        }
    }
    // F4 frente D: medida semi-aditiva — v1 é GUARDA (erro educativo quando a
    // dimensão `over` é colapsada); compilar take: last/avg de verdade é P2.
    if (m.semi_additive !== undefined) {
      const sa = m.semi_additive;
      if (isDerived) err(p + '.semi_additive', 'declare na métrica base — a derived herda pelos operandos');
      else if (!sa || typeof sa !== 'object' || !dims[sa.over]) err(p + '.semi_additive.over', 'dimensão do modelo (ex.: tempo)');
      else if (!['last', 'avg'].includes(sa.take)) err(p + '.semi_additive.take', 'last ou avg');
    }
    if (isBase) {
      if (!AGGS.has(m.agg)) err(p + '.agg', `agg deve ser um de: ${[...AGGS].join(', ')}`);
      if (typeof m.column !== 'string') err(p + '.column', 'obrigatório');
      else checkCol(p + '.column', m.column);
    } else {
      const r = parseDerived(m.derived, baseNames);
      if (!r.ok) err(p + '.derived', r.error);
    }
  }

  for (const [i, j] of (cat.joins || []).entries()) {
    const p = `joins[${i}]`;
    if (!j || typeof j !== 'object') {
      err(p, 'join deve ser objeto {left, right, type}');
      continue;
    }
    if (!TABLE_COL.test(String(j.left || ''))) err(p + '.left', 'formato tabela.coluna');
    if (!TABLE_COL.test(String(j.right || ''))) err(p + '.right', 'formato tabela.coluna');
    if (j.type !== undefined && !['left', 'inner'].includes(j.type)) err(p + '.type', 'left ou inner');
    // F4 frente D: cardinalidade left→right (fato→dimensão). many_to_one é o
    // caminho seguro; one_to_many declarado liga a guarda de fan-out no compilador.
    if (j.cardinality !== undefined && !['many_to_one', 'one_to_one', 'one_to_many'].includes(j.cardinality))
      err(p + '.cardinality', 'many_to_one (default) | one_to_one | one_to_many');
    // lado que vive no fato é conferível com o schema real
    for (const side of ['left', 'right']) {
      const [t, c] = String(j[side] || '').split('.');
      if (t === cat.fact) checkCol(p + '.' + side, c);
    }
  }

  for (const [name, pol] of Object.entries(cat.policies || {})) {
    const p = 'policies.' + name;
    if (!dims[name]) err(p, `dimensão "${name}" não existe no modelo`);
    if (!pol || !['internal', 'public'].includes(pol.expose)) err(p + '.expose', 'internal ou public');
  }

  // F4 frente G: hierarquias ENTRE dimensões (grosso → fino) — habilitam drill.
  const emHierarquia = new Map();
  for (const [name, levels] of Object.entries(cat.hierarchies || {})) {
    const p = 'hierarchies.' + name;
    if (levels === null || levels === undefined) continue; // "tempo: ~" = anotação
    if (!Array.isArray(levels) || levels.length < 2) {
      err(p, 'lista ordenada (grosso → fino) com ≥2 dimensões do modelo');
      continue;
    }
    for (const l of levels) {
      if (!dims[l]) err(p, `dimensão "${l}" não existe no modelo`);
      else if (emHierarquia.has(l)) err(p, `"${l}" já pertence à hierarquia "${emHierarquia.get(l)}" (v1: uma por dimensão)`);
      emHierarquia.set(l, name);
    }
  }

  return errors;
}

/** Hierarquia (entre dims) a que a dimensão pertence, ou null. */
export function hierarchyOf(cat, dimName) {
  for (const [name, levels] of Object.entries(cat?.hierarchies || {})) {
    if (Array.isArray(levels) && levels.includes(dimName)) return { name, levels };
  }
  return null;
}

/** Dimensões com expose: internal (política de publish público — spec §6). */
export function internalDims(cat) {
  const out = new Set();
  for (const [name, pol] of Object.entries(cat?.policies || {})) {
    if (pol?.expose === 'internal') out.add(name);
  }
  for (const [name, d] of Object.entries(cat?.dimensions || {})) {
    if (d?.pii && !(cat.policies || {})[name]) out.add(name); // pii sem política explícita = interna
  }
  // F4 frente C: dimensão calculada (bins/map) sobre coluna de dim interna
  // HERDA a política — sem vazamento por derivação (a menos de política explícita).
  for (const [name, d] of Object.entries(cat?.dimensions || {})) {
    const src = d?.bins?.column || d?.map?.column;
    if (!src || (cat.policies || {})[name]) continue;
    for (const [on, od] of Object.entries(cat.dimensions)) {
      if (on === name || !out.has(on)) continue;
      const cols = od.columns || (od.column ? [od.column] : []);
      if (cols.includes(src)) out.add(name);
    }
  }
  return out;
}
