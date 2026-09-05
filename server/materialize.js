// Views MATERIALIZADAS (Fase Fontes §2): banco externo → parquet local.
// O banco externo NUNCA é consultado no runtime de páginas — o ATTACH vive
// SÓ aqui, no momento da extração (↻), numa conexão avulsa e efêmera.
//
// Convenção da query de extração: o banco anexado chama-se `ext`
// (ex.: select * from ext.apc_aprovados).
import path from 'node:path';
import fs from 'node:fs';
import { parseDocument } from 'yaml';
import { DuckDBInstance } from '@duckdb/node-api';
import { PROJECTS_DIR, ROOT, sqlPath, registerSource } from './db.js';
import { readProjectConfig, resolveSecret } from './projectConfig.js';
import { readConnections, attachPlanFor, openExternal, createExtractionInstance, redactSecrets } from './connections.js';

// String/cláusulas de ATTACH por tipo. duckdb = nativo (sem extensão);
// postgres/mysql/sqlite exigem INSTALL/LOAD (rede na 1ª vez — ambiente do cliente).
function attachPlan(project, conn) {
  const type = conn.type || 'duckdb';
  const secret = conn.credentials_ref ? resolveSecret(project, conn.credentials_ref) : undefined;
  if (type === 'duckdb') {
    const target = secret || conn.path;
    if (!target) throw new Error('connection duckdb precisa de path (ou credentials_ref)');
    // caminho relativo resolve contra a raiz do studio-console (não o cwd do server)
    const abs = path.isAbsolute(String(target)) ? String(target) : path.resolve(ROOT, String(target));
    return { setup: [], attach: `ATTACH '${sqlPath(abs)}' AS ext (READ_ONLY)` };
  }
  if (!secret) throw new Error(`credencial "${conn.credentials_ref}" não encontrada em .secrets.json (grave via PUT /secrets)`);
  if (['postgres', 'mysql', 'sqlite'].includes(type)) {
    return {
      setup: [`INSTALL ${type}`, `LOAD ${type}`],
      attach: `ATTACH '${String(secret).replace(/'/g, "''")}' AS ext (TYPE ${type}, READ_ONLY)`,
    };
  }
  throw new Error(`tipo de connection desconhecido: ${type}`);
}

/**
 * Edição CIRÚRGICA do project.yaml (preserva comentários/formatação):
 * grava last_refresh/last_error na entrada da fonte (DELTA §4 [P]).
 */
function updateMaterializedMeta(project, name, meta) {
  const safeProj = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  const f = path.join(PROJECTS_DIR, safeProj, 'project.yaml');
  if (!fs.existsSync(f)) return;
  const doc = parseDocument(fs.readFileSync(f, 'utf8'));
  for (const [k, v] of Object.entries(meta)) {
    if (v === null) doc.deleteIn(['materialized', name, k]);
    else doc.setIn(['materialized', name, k], v);
  }
  fs.writeFileSync(f, doc.toString(), 'utf8');
}

/**
 * Cria a ENTRADA da view materializada no project.yaml (DELTA §3) e roda a
 * 1ª materialização. A query persiste versionável; a credencial fica no
 * registro global, referenciada por nome.
 */
export async function createMaterialized(project, { name, connection, query, stale_after }) {
  if (project === 'scratch') throw new Error('Views materializadas exigem projeto nomeado.');
  const safe = String(name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  if (!safe) throw new Error('nome da fonte é obrigatório');
  if (!connection || !readConnections()[connection]) throw new Error(`conexão "${connection}" não registrada — cadastre no menu Conexões`);
  if (!query || !String(query).trim()) throw new Error('query de extração é obrigatória');
  const safeProj = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  const f = path.join(PROJECTS_DIR, safeProj, 'project.yaml');
  const doc = parseDocument(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  if (doc.getIn(['materialized', safe])) throw new Error(`fonte "${safe}" já existe no project.yaml`);
  doc.setIn(['materialized', safe, 'connection'], connection);
  doc.setIn(['materialized', safe, 'query'], String(query).trim());
  if (stale_after) doc.setIn(['materialized', safe, 'stale_after'], String(stale_after));
  fs.writeFileSync(f, doc.toString(), 'utf8');
  return refreshMaterialized(project, safe);
}

/**
 * ↻ Refresh de uma view materializada: ATTACH efêmero → COPY para
 * <nome>.parquet.tmp → SWAP atômico no sucesso (DELTA §4: re-run interrompido
 * nunca corrompe o parquet em uso). last_refresh grava SÓ em sucesso; falha
 * mantém o timestamp anterior e grava last_error.
 */
export async function refreshMaterialized(project, name) {
  if (project === 'scratch') throw new Error('Views materializadas exigem projeto nomeado.');
  const cfg = readProjectConfig(project);
  const m = (cfg.materialized || {})[name];
  if (!m) throw new Error(`view materializada "${name}" não declarada no project.yaml`);

  const safeProj = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  const sourcesDir = path.join(PROJECTS_DIR, safeProj, 'sources');
  fs.mkdirSync(sourcesDir, { recursive: true });
  const target = path.join(sourcesDir, name.replace(/[^a-zA-Z0-9_]/g, '_') + '.parquet');
  const tmp = target + '.tmp';

  try {
    // Conexão GLOBAL por nome (DELTA §1) com fallback legado ao project.yaml.
    const plan = readConnections()[m.connection]
      ? attachPlanFor(m.connection)
      : (cfg.connections || {})[m.connection]
        ? attachPlan(project, (cfg.connections || {})[m.connection])
        : (() => {
            throw new Error(`conexão "${m.connection}" não registrada — cadastre no menu Conexões`);
          })();

    // Instância EFÊMERA: o ATTACH nem encosta na instância que serve as páginas.
    const inst = await createExtractionInstance();
    const c = await inst.connect();
    try {
      await openExternal(c, plan);
      await c.run(`COPY (${String(m.query).replace(/;\s*$/, '')}) TO '${sqlPath(tmp)}' (FORMAT parquet)`);
    } finally {
      try {
        c.closeSync?.();
      } catch {
        /* efêmera — morre com o processo de qualquer forma */
      }
    }
    fs.renameSync(tmp, target); // swap atômico: só troca com o novo completo
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp);
    } catch {
      /* tmp órfão é inofensivo */
    }
    // REDIGE segredos: o driver pode ecoar a connection string no erro, e o
    // last_error vai para o project.yaml (versionável).
    const msg = redactSecrets(String(e.message || e));
    updateMaterializedMeta(project, name, { last_error: msg });
    throw new Error(msg);
  }
  const materializedAt = new Date().toISOString();
  updateMaterializedMeta(project, name, { last_refresh: materializedAt, last_error: null });
  await registerSource(target, name.replace(/[^a-zA-Z0-9_]/g, '_'), project);
  return { target, materializedAt };
}

// ---- MOUNTS (spec §2): object storage / pasta de rede — a console SÓ LÊ. ----
// base_url: http(s):// ou s3:// (exigem httpfs — INSTALL no ambiente do cliente)
// ou CAMINHO local/UNC (read_parquet direto, sem extensão). O contrato com o
// Airflow é "parquet com schema estável no caminho combinado".

function mountUrl(mount, file) {
  const base = String(mount.base_url).replace(/[\/\\]+$/, '');
  const prefix = mount.prefix ? String(mount.prefix).replace(/^[\/\\]+|[\/\\]+$/g, '') + '/' : '';
  return `${base}/${prefix}${file}`;
}

const isRemote = (u) => /^(https?|s3|s3a|abfss?):\/\//i.test(String(u));

/** Lista os parquets de um mount (local: readdir; remoto: exige manifest ou nomes conhecidos). */
export function listMountFiles(project, mountName) {
  const cfg = readProjectConfig(project);
  const mt = (cfg.mounts || {})[mountName];
  if (!mt) throw new Error(`mount "${mountName}" não declarado no project.yaml`);
  if (isRemote(mt.base_url)) {
    // sem listagem genérica de bucket sem SDK — o contrato usa `files:` declarados
    return (mt.files || []).map((f) => ({ file: f, url: mountUrl(mt, f) }));
  }
  const dir = path.isAbsolute(mt.base_url) ? mt.base_url : path.resolve(ROOT, mt.base_url);
  const sub = mt.prefix ? path.join(dir, mt.prefix) : dir;
  if (!fs.existsSync(sub)) return [];
  return fs
    .readdirSync(sub)
    .filter((f) => f.toLowerCase().endsWith('.parquet'))
    .map((f) => ({
      file: f,
      url: path.join(sub, f),
      materializedAt: fs.statSync(path.join(sub, f)).mtime.toISOString(),
    }));
}

/**
 * Registra as fontes de um mount como views read_parquet(url) — runtime lê o
 * parquet REMOTO/da pasta; refresh é EXTERNO (Airflow sobrescreve o objeto).
 * Retorna { registered: [{name, url}] }.
 */
export async function registerMountSources(project, mountName) {
  if (project === 'scratch') throw new Error('Mounts exigem projeto nomeado.');
  const cfg = readProjectConfig(project);
  const mt = (cfg.mounts || {})[mountName];
  if (!mt) throw new Error(`mount "${mountName}" não declarado`);
  const files = listMountFiles(project, mountName);
  const { getConnection, schemaName } = await import('./db.js');
  const conn = await getConnection(project);
  const schema = schemaName(project);
  const registered = [];
  for (const f of files) {
    const name = f.file.replace(/\.parquet$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (isRemote(f.url)) await conn.run(`INSTALL httpfs; LOAD httpfs;`);
    await conn.run(`CREATE OR REPLACE VIEW "${schema}"."${name}" AS SELECT * FROM read_parquet('${sqlPath(String(f.url))}')`);
    registered.push({ name, url: String(f.url) });
  }
  return { registered };
}

/** Mapa fonte→URL dos mounts (☁ publish lê DIRETO, sem copiar — spec §2). */
export function mountSourceUrls(project) {
  const cfg = readProjectConfig(project);
  const out = {};
  for (const mountName of Object.keys(cfg.mounts || {})) {
    try {
      for (const f of listMountFiles(project, mountName)) {
        const name = f.file.replace(/\.parquet$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        out[name] = { url: String(f.url), remote: isRemote(f.url), file: f.file, mount: mountName, materializedAt: f.materializedAt };
      }
    } catch {
      /* mount quebrado não derruba o publish das demais fontes */
    }
  }
  return out;
}

/** Metadados de frescor das fontes do projeto (spec §5). */
export function sourceFreshness(project) {
  const cfg = readProjectConfig(project);
  const safeProj = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  const sourcesDir = path.join(PROJECTS_DIR, safeProj, 'sources');
  const out = {};
  if (fs.existsSync(sourcesDir)) {
    for (const f of fs.readdirSync(sourcesDir)) {
      const full = path.join(sourcesDir, f);
      if (!fs.statSync(full).isFile()) continue;
      const name = f.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      out[name] = { materializedAt: fs.statSync(full).mtime.toISOString() };
    }
  }
  const parseDur = (s) => {
    const m = String(s || '').match(/^(\d+)([dhm])$/);
    if (!m) return 7 * 864e5;
    return Number(m[1]) * (m[2] === 'd' ? 864e5 : m[2] === 'h' ? 36e5 : 6e4);
  };
  for (const [name, mv] of Object.entries(cfg.materialized || {})) {
    const key = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const meta = out[key] || (out[key] = {});
    meta.kind = 'materialized';
    meta.connection = mv.connection;
    // last_refresh do project.yaml é a FONTE DE VERDADE (DELTA §4); mtime do
    // parquet fica só como fallback de exibição.
    if (mv.last_refresh) meta.materializedAt = mv.last_refresh;
    if (mv.last_error) meta.lastError = String(mv.last_error);
    if (meta.materializedAt) {
      meta.stale = Date.now() - Date.parse(meta.materializedAt) > parseDur(mv.stale_after);
    } else {
      meta.stale = true; // nunca extraída
    }
  }
  // Mounts: frescor = mtime/Last-Modified do objeto; refresh é EXTERNO (Airflow).
  for (const [name, meta] of Object.entries(mountSourceUrls(project))) {
    out[name] = { ...(out[name] || {}), kind: 'mount', materializedAt: meta.materializedAt, remote: meta.remote };
  }
  return out;
}
