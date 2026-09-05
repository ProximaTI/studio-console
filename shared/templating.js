// Templating ÚNICO (estilo Evidence): interpolação inline {...} e placeholders SQL.
// Consumido por: preview React, notebook, geradores de publish (Node) e — via bundle
// StudioRuntime — pelos próprios apps publicados no navegador.

/** Extrai o nome do parâmetro de "[sigla].md" -> "sigla". null se não-parametrizada. */
export function paramNameFromFile(fileName) {
  const base = String(fileName || '').split('/').pop() || '';
  const m = base.match(/^\[(\w+)\]\.md$/);
  return m ? m[1] : null;
}

/** Escapa aspas simples para injeção de string em SQL (params/inputs são string). */
export function escapeSqlValue(v) {
  return String(v ?? '').replace(/'/g, "''");
}

// Aceita tanto inputs no formato { nome: valor } quanto { nome: { value: valor } }.
function inputValue(inputs, n) {
  const raw = inputs ? inputs[n] : undefined;
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value;
  return raw;
}

/**
 * Substitui placeholders no SQL antes de executar.
 * Sintaxe Evidence (canônica): ${params.X} e ${inputs.X} / ${inputs.X.value}.
 * Alias legado da console: ${$page.params.X}.
 */
export function applyTemplates(sql, inputs, params) {
  return String(sql)
    .replace(/\$\{\s*(?:\$page\.)?params\.(\w+)\s*\}/g, (_m, n) => escapeSqlValue(params ? params[n] : ''))
    // DateRange: ${inputs.x.start} / ${inputs.x.end} — o input guarda {start, end}.
    .replace(/\$\{\s*inputs\.(\w+)\.(start|end)\s*\}/g, (_m, n, k) => {
      const raw = inputs ? inputs[n] : undefined;
      const v = raw && typeof raw === 'object' ? raw[k] : undefined;
      return v === undefined || v === null ? '' : escapeSqlValue(v);
    })
    .replace(/\$\{\s*inputs\.(\w+)(?:\.value)?\s*\}/g, (_m, n) => {
      const v = inputValue(inputs, n);
      if (v === undefined || v === null) return '';
      // Multi-select (Dropdown multiple): vira lista quotada p/ IN (${inputs.x})
      if (Array.isArray(v)) return v.map((x) => "'" + escapeSqlValue(x) + "'").join(',');
      return escapeSqlValue(v);
    });
}

// Avalia uma expressão JS num escopo dado. Erros não quebram a página.
function evalExpr(expr, scope) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('scope', 'with (scope) { return (' + expr + '); }');
    return fn(scope);
  } catch {
    return '⟨?⟩';
  }
}

/**
 * Troca {expr} no texto pelo resultado avaliado sobre o escopo
 * {...dataMap, params, inputs, $page}. Mantém \{ escapado.
 * Sintaxe Evidence: {params.x}, {inputs.x.value}, {query[0].col}, {query.length}.
 */
export function renderInline(text, dataMap, params, inputs) {
  const scope = {
    ...(dataMap || {}),
    params: params || {},
    inputs: inputs || {},
    $page: { params: params || {} },
  };
  return String(text)
    .replace(/(^|[^\\])\{([^{}]+)\}/g, (_full, pre, expr) => {
      const val = evalExpr(expr.trim(), scope);
      const out = val === undefined || val === null ? '' : String(val);
      return pre + out;
    })
    .replace(/\\\{/g, '{');
}

/** Nomes de inputs usados via ${inputs.X}, ${inputs.X.value} ou ${inputs.X.start|end}. */
export function collectInputNames(src) {
  const set = new Set();
  const re = /\$\{\s*inputs\.(\w+)(?:\.(?:value|start|end))?\s*\}/g;
  let m;
  while ((m = re.exec(String(src || '')))) set.add(m[1]);
  return [...set];
}

/** Nomes de parâmetros referenciados via params.X ou $page.params.X (SQL ou texto). */
export function collectParamRefs(src) {
  const set = new Set();
  const re = /(?:\$page\.)?\bparams\.(\w+)/g;
  let m;
  while ((m = re.exec(String(src || '')))) set.add(m[1]);
  return [...set];
}

/**
 * Resolve o VALOR de um atributo de componente em tempo de render:
 *  - "inputs.X.value" / "inputs.X"   -> valor atual do input
 *  - "params.X" / "$page.params.X"   -> valor do parâmetro da página
 *  - '["a", "b"]'                    -> array (JSON; aceita aspas simples)
 *  - "texto com {expr}"              -> interpolação inline (urls, labels)
 *  - demais strings                  -> inalteradas
 */
export function resolveAttr(v, ctx) {
  if (typeof v !== 'string') return v;
  const { dataMap, params, inputs } = ctx || {};
  let m = v.match(/^inputs\.(\w+)(?:\.value)?$/);
  if (m) return inputValue(inputs, m[1]);
  m = v.match(/^(?:\$page\.)?params\.(\w+)$/);
  if (m) return params ? params[m[1]] : undefined;
  if (/^\[[\s\S]*\]$/.test(v.trim())) {
    try {
      return JSON.parse(v.replace(/'/g, '"'));
    } catch {
      return v;
    }
  }
  if (v.includes('{')) return renderInline(v, dataMap, params, inputs);
  return v;
}

/** Aplica resolveAttr a todos os atributos de um componente. */
export function resolveAttrs(attrs, ctx) {
  const out = {};
  for (const k of Object.keys(attrs || {})) out[k] = resolveAttr(attrs[k], ctx);
  return out;
}
