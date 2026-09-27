// Servir pacotes publicados — o MESMO código para a prévia do console (rota
// /api/projects/:p/app/...) e para o servidor estático de produção
// (server/static.js). Só arquivos, só GET/HEAD, com Range (o DuckDB-WASM lê
// Parquet por HTTP e pode pedir pedaços) e cabeçalhos de segurança.
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.parquet': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * Cabeçalhos de segurança dos pacotes.
 *
 * O runtime publicado tem <script> inline (ECharts, markdown-it, StudioRuntime),
 * `new Function` nas expressões {…} do texto (shared/templating.js) e WASM —
 * daí 'unsafe-inline', 'unsafe-eval' e 'wasm-unsafe-eval'. connect-src aceita
 * https: aqui porque cada app.html estreita a lista com a sua própria CSP em
 * <meta> (origens de baseUrl e mounts remotos); as duas políticas valem juntas.
 */
export function securityHeaders({ frameAncestors = "'self'" } = {}) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

/** Resolve `rel` dentro de `root`; null se escapar, ou se tocar arquivo oculto. */
export function resolveInside(root, rel) {
  const base = path.resolve(root);
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  const parts = path.relative(base, p).split(path.sep);
  if (parts.some((s) => s.startsWith('.'))) return null;
  return p;
}

function cacheControl(file) {
  // Runtime do DuckDB muda raramente; html e dados precisam revalidar (troca
  // mensal do parquet tem de aparecer no reload).
  return /[\\/]duckdb[\\/]/.test(file) ? 'public, max-age=3600' : 'no-cache';
}

/** Intervalo de um cabeçalho Range simples (um só intervalo). */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return { invalid: true };
  return { start, end };
}

/**
 * Serve um arquivo (res é http.ServerResponse — vale para Express também).
 * Devolve false se o arquivo não existe, para o chamador responder 404.
 */
export function serveFile(req, res, file, headers = {}) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const common = {
    ...headers,
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl(file),
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, common);
    res.end();
    return true;
  }
  const range = req.headers.range ? parseRange(req.headers.range, st.size) : null;
  if (range?.invalid) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${st.size}` });
    res.end();
    return true;
  }
  const { start, end } = range || { start: 0, end: st.size - 1 };
  const status = range ? 206 : 200;
  res.writeHead(status, {
    ...common,
    'Content-Length': st.size === 0 ? 0 : end - start + 1,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${st.size}` } : {}),
  });
  if (req.method === 'HEAD' || st.size === 0) {
    res.end();
    return true;
  }
  fs.createReadStream(file, { start, end }).pipe(res);
  return true;
}

function send(res, status, text, headers = {}) {
  res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Handler do servidor estático: serve `dir` sob `prefix`, sem listagem de
 * diretório (pasta com app.html serve o app.html) e sem nenhuma outra rota.
 */
export function createStaticHandler({ dir, prefix = '/', frameAncestors = "'self'" } = {}) {
  const pre = '/' + String(prefix).replace(/^\/+|\/+$/g, '');
  const base = pre === '/' ? '/' : pre + '/';
  const sec = securityHeaders({ frameAncestors });
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido', { ...sec, Allow: 'GET, HEAD' });
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(res, 400, 'Caminho inválido', sec);
    }
    if (pathname === pre && pre !== '/') return send(res, 404, 'Não encontrado', sec);
    if (!pathname.startsWith(base)) return send(res, 404, 'Não encontrado', sec);
    let file = resolveInside(dir, pathname.slice(base.length) || '.');
    if (!file) return send(res, 400, 'Caminho inválido', sec);
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'app.html');
    } catch {
      /* inexistente: 404 abaixo */
    }
    if (!serveFile(req, res, file, sec)) send(res, 404, 'Não encontrado', sec);
  };
}
