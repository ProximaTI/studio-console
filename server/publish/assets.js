// Assets do publish: bundles, vendors (ECharts/markdown-it), GeoJSON, DuckDB-WASM
// e o shell HTML/CSS comum aos dois modos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const ECHARTS_PATH = path.join(ROOT, 'node_modules', 'echarts', 'dist', 'echarts.min.js');
const MARKDOWNIT_PATH = path.join(ROOT, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js');
const DUCKDB_WASM_DIST = path.join(ROOT, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const MAPS_DIR = path.join(ROOT, 'web', 'public', 'maps');

// Bundle IIFE do módulo compartilhado (shared/runtime.js) -> window.StudioRuntime.
// Inclui o createPublishRenderer — os apps usam EXATAMENTE o mesmo código.
// Cache por assinatura (mtime de shared/*.js): editar shared/ sem reiniciar a
// API não publica mais um bundle velho.
let runtimeBundleCache = null;
let runtimeBundleSig = '';
function sharedSignature() {
  const dir = path.join(ROOT, 'shared');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => f + ':' + fs.statSync(path.join(dir, f)).mtimeMs)
      .join('|');
  } catch {
    return '';
  }
}
export async function getRuntimeBundle() {
  const sig = sharedSignature();
  if (runtimeBundleCache && sig === runtimeBundleSig) return runtimeBundleCache;
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'shared', 'runtime.js')],
    bundle: true,
    format: 'iife',
    globalName: 'StudioRuntime',
    write: false,
    platform: 'browser',
    logLevel: 'silent',
  });
  runtimeBundleCache = r.outputFiles[0].text;
  runtimeBundleSig = sig;
  return runtimeBundleCache;
}

export function readVendors() {
  return {
    echarts: fs.existsSync(ECHARTS_PATH) ? fs.readFileSync(ECHARTS_PATH, 'utf8') : '',
    markdownit: fs.existsSync(MARKDOWNIT_PATH) ? fs.readFileSync(MARKDOWNIT_PATH, 'utf8') : '',
  };
}

/** GeoJSON usados por ConnectionMap/AreaMap (recursivo em containers). */
export function collectMaps(blocks) {
  const used = new Set();
  const walk = (list) => {
    for (const b of list || []) {
      if (b.type === 'component') {
        if (b.name === 'ConnectionMap') used.add(b.attrs.map === 'brazil' ? 'brazil' : 'world');
        if (b.name === 'AreaMap') used.add('brazil');
        if (b.children) walk(b.children);
      }
    }
  };
  walk(blocks);
  const maps = {};
  for (const name of used) {
    const f = path.join(MAPS_DIR, name + '.geo.json');
    if (fs.existsSync(f)) {
      try {
        maps[name] = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        /* ignora geojson inválido */
      }
    }
  }
  return maps;
}

const WASM_FILES = ['duckdb-mvp.wasm', 'duckdb-browser-mvp.worker.js', 'duckdb-eh.wasm', 'duckdb-browser-eh.worker.js'];

/** Copia o runtime DuckDB-WASM e gera o módulo browser bundlado (apache-arrow inline). */
export async function copyDuckdbRuntime(outDir) {
  const duckDir = path.join(outDir, 'duckdb');
  fs.mkdirSync(duckDir, { recursive: true });
  for (const f of WASM_FILES) {
    const src = path.join(DUCKDB_WASM_DIST, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(duckDir, f));
  }
  await esbuild.build({
    entryPoints: [path.join(DUCKDB_WASM_DIST, 'duckdb-browser.mjs')],
    outfile: path.join(duckDir, 'duckdb-browser.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

/** CSS comum dos apps publicados (tema claro/escuro pelo settings). */
export function publishCss(theme) {
  const t = theme || {};
  const dark = t.mode === 'dark';
  return `
  :root{
    --bg:${t.background || (dark ? '#1a1a1d' : '#f7f7f8')};
    --card:${t.card || (dark ? '#26262b' : '#ffffff')};
    --primary:${t.primary || '#236aa4'};
    --text:${dark ? '#e7e7ea' : '#1d1d20'};
    --muted:${dark ? '#9a9aa2' : '#6b7280'};
    --border:${dark ? '#3a3a40' : '#e5e7eb'};
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter',-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px}
  .wrap{max-width:980px;margin:0 auto;padding:28px 24px 80px}
  h1{font-size:26px;margin:0 0 8px}
  h2{font-size:19px;margin:26px 0 10px}
  p{line-height:1.5}
  .pub-banner{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 14px;color:var(--muted);font-size:12px;margin-bottom:18px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
  .bigvalue{display:inline-block;vertical-align:top;min-width:160px;margin:8px 12px 8px 0;padding:14px 18px;border-radius:10px;background:var(--card);border:1px solid var(--border)}
  .bv-title{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .bv-value{font-size:26px;font-weight:700;margin-top:4px}
  .chart{height:320px;background:var(--card);border:1px solid var(--border);border-radius:10px;margin:10px 0;padding:6px}
  .dropdown{margin:14px 0}
  select,input,button{font:inherit}
  select,input{padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text)}
  table.grid{border-collapse:collapse;width:100%;font-size:13px;background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
  .grid th,.grid td{border-bottom:1px solid var(--border);padding:7px 10px;text-align:left;white-space:nowrap}
  .grid th{background:var(--bg);font-weight:600}
  .grid th.num,.grid td.num{text-align:right;font-variant-numeric:tabular-nums}
  .grid th.ctr,.grid td.ctr{text-align:center}
  .grid td.wrap{white-space:normal;min-width:220px}
  .dt-toolbar{display:flex;gap:10px;align-items:center;margin:10px 0 0}
  .dt-toolbar input{width:220px}
  .dt-toolbar button{cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--text);padding:5px 12px;border-radius:6px}
  .ev-details{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin:12px 0}
  .ev-details summary{cursor:pointer;font-weight:600;font-size:13px;color:var(--primary)}
  .ev-details-body{padding-top:8px}
  .ev-grid{margin:14px 0}
  .ev-div{min-width:0}
  .ev-value{font-weight:700}
  .note{background:#eef6fc;border-left:3px solid var(--primary);border-radius:0 8px 8px 0;padding:10px 14px;margin:12px 0;font-size:13px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:8px 0}
  .card-title{font-weight:600;margin-bottom:6px}
  .linkbtn{display:inline-block;margin:8px 8px 8px 0;padding:6px 14px;border:1px solid var(--primary);border-radius:6px;color:var(--primary);text-decoration:none}
  .muted{color:var(--muted)}
  .repeat{display:flex;flex-direction:column;gap:14px;margin:12px 0}
  .repeat-group{border:1px solid var(--border);border-radius:10px;padding:10px 14px;background:var(--card)}
  .repeat-title{font-weight:600;font-size:13px;color:var(--primary);margin-bottom:8px}
  #status{padding:40px;text-align:center;color:var(--muted)}
  .err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:10px 12px;border-radius:6px;font-family:ui-monospace,monospace;font-size:13px}
  .pb{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 14px;margin-bottom:14px}
  .pb b{color:var(--primary)}
  .md a{color:var(--primary)}`;
}
