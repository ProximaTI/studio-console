// Motor de dados: DuckDB (instância única) com um SCHEMA por projeto.
// Cada projeto tem seu schema "proj_<slug>"; as fontes do projeto (arquivos em
// projects/<p>/sources/ + views derivadas em sources/*.sql) viram VIEWs nesse
// schema. Uma conexão por projeto fica cacheada com search_path='proj_<slug>,main'
// — assim o SQL das páginas referencia as fontes sem prefixo e um projeto não
// enxerga as fontes de outro (isolamento do critério §7.2 da spec).
import { DuckDBInstance } from '@duckdb/node-api';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..'); // studio-console/
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const PROJECTS_DIR = path.join(ROOT, 'projects');
export const MODELS_DIR = path.join(ROOT, 'models');
export const SETTINGS_FILE = path.join(ROOT, 'settings.json');

let instance = null;
const connByProject = new Map(); // slug -> connection (search_path próprio)

async function getInstance() {
  if (!instance) instance = await DuckDBInstance.create(':memory:');
  return instance;
}

// slug do schema do projeto (nome DuckDB seguro).
export function schemaName(project) {
  const slug = String(project || 'scratch')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_') || 'scratch';
  return 'proj_' + slug;
}

// Conexão cacheada do projeto: schema criado + search_path fixado uma vez.
// O catálogo (schemas/views) é compartilhado entre conexões da mesma instância,
// então registrar uma fonte por qualquer conexão vale para todas.
export async function getConnection(project = 'scratch') {
  const key = schemaName(project);
  if (connByProject.has(key)) return connByProject.get(key);
  const inst = await getInstance();
  const conn = await inst.connect();
  await conn.run(`CREATE SCHEMA IF NOT EXISTS "${key}"`);
  await conn.run(`SET search_path = '${key},main'`);
  connByProject.set(key, conn);
  return conn;
}

// Escapa um caminho para uso dentro de string SQL (barras normais + aspas duplicadas).
export function sqlPath(p) {
  return p.replace(/\\/g, '/').replace(/'/g, "''");
}

// Deriva um nome de tabela válido a partir do nome do arquivo.
export function sourceNameFromFile(file) {
  const base = path.basename(file, path.extname(file));
  let name = base.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (/^[0-9]/.test(name)) name = 's_' + name;
  return name;
}

function readerFor(file) {
  const ext = path.extname(file).toLowerCase();
  const p = sqlPath(file);
  if (ext === '.csv') return `read_csv_auto('${p}')`;
  if (ext === '.parquet') return `read_parquet('${p}')`;
  if (ext === '.json') return `read_json_auto('${p}')`;
  return null;
}

// Registra um arquivo como VIEW no schema do projeto (qualificado — determinístico).
export async function registerSource(file, name, project = 'scratch') {
  const reader = readerFor(file);
  if (!reader) throw new Error('Formato não suportado: ' + path.extname(file));
  const viewName = name || sourceNameFromFile(file);
  const conn = await getConnection(project);
  const schema = schemaName(project);
  await conn.run(`CREATE OR REPLACE VIEW "${schema}"."${viewName}" AS SELECT * FROM ${reader}`);
  return viewName;
}

// Registra todas as fontes de um projeto: arquivos (csv/parquet/json) e, depois,
// as views derivadas (sources/*.sql, ex.: vendas_base.sql) rodadas na conexão do
// projeto (search_path próprio) para poderem referenciar as fontes já criadas.
export async function registerProjectSources(project, sourcesDir) {
  if (!sourcesDir || !fs.existsSync(sourcesDir)) return;
  const entries = fs.readdirSync(sourcesDir, { withFileTypes: true }).filter((e) => e.isFile());
  for (const e of entries) {
    const full = path.join(sourcesDir, e.name);
    if (readerFor(full)) {
      try {
        await registerSource(full, null, project);
      } catch (err) {
        console.error(`[${project}] fonte ${e.name}:`, err.message);
      }
    }
  }
  const conn = await getConnection(project); // search_path='proj_x,main'
  for (const e of entries.filter((x) => x.name.endsWith('.sql')).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      await conn.run(fs.readFileSync(path.join(sourcesDir, e.name), 'utf8'));
    } catch (err) {
      console.error(`[${project}] view ${e.name}:`, err.message);
    }
  }
}

// Diretório de fontes de um projeto interno ou externo (com campo "sources").
function externalConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'external-projects.json'), 'utf8'));
  } catch {
    return {};
  }
}
function sourcesDirFor(project, ext) {
  if (ext) {
    if (!ext.sources) return null;
    return path.resolve(ROOT, 'server', ext.root || '.', ext.sources);
  }
  return path.join(PROJECTS_DIR, project, 'sources');
}

// Esqueleto padrão de um projeto (layout Evidence): pages/ + sources/ + queries/.
// Usado no boot (scratch), na criação e na re-criação pós-promote/delete do scratch.
export function ensureProjectSkeleton(name, title) {
  const dir = path.join(PROJECTS_DIR, name);
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'queries'), { recursive: true });
  const idx = path.join(dir, 'pages', 'index.md');
  if (!fs.existsSync(idx)) fs.writeFileSync(idx, `# ${title || name}\n\nNova página. Escreva Markdown + SQL.\n`);
  return dir;
}

// Remove o schema do projeto (e a conexão cacheada). Usa uma conexão avulsa da
// instância — nunca a do próprio projeto (o search_path dela aponta pro schema
// que está sendo derrubado).
export async function dropProjectSchema(project) {
  const key = schemaName(project);
  connByProject.delete(key);
  const inst = await getInstance();
  const conn = await inst.connect();
  await conn.run(`DROP SCHEMA IF EXISTS "${key}" CASCADE`);
}

// Boot: registra as fontes de todos os projetos (internos com sources/ + externos
// com "sources" no external-projects.json).
export async function registerAllProjects() {
  ensureProjectSkeleton('scratch', 'Rascunho'); // projeto rascunho é um projeto REAL
  const externals = externalConfig();
  if (fs.existsSync(PROJECTS_DIR)) {
    for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (d.isDirectory()) await registerProjectSources(d.name, sourcesDirFor(d.name, null));
    }
  }
  for (const [name, ext] of Object.entries(externals)) {
    const dir = sourcesDirFor(name, ext);
    if (dir) await registerProjectSources(name, dir);
  }
  // Fontes de MOUNT declaradas no project.yaml (import lazy — evita ciclo).
  try {
    const { registerMountSources } = await import('./materialize.js');
    const { readProjectConfig } = await import('./projectConfig.js');
    for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const m of Object.keys(readProjectConfig(d.name).mounts || {})) {
        try {
          await registerMountSources(d.name, m);
        } catch (e) {
          console.error(`[${d.name}] mount ${m}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('mounts no boot:', e.message);
  }
  await getConnection('scratch');
}

function normalizeValue(v) {
  if (typeof v === 'bigint') {
    return (v >= -9007199254740991n && v <= 9007199254740991n) ? Number(v) : v.toString();
  }
  if (v === null || v === undefined) return v;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v.toString === 'function') return v.toString();
  }
  return v;
}

export async function runQuery(sql, project = 'scratch') {
  const conn = await getConnection(project);
  const result = await conn.runAndReadAll(sql);
  const columns = result.columnNames();
  const rows = result.getRowObjects().map((r) => {
    const o = {};
    for (const k of Object.keys(r)) o[k] = normalizeValue(r[k]);
    return o;
  });
  return { columns, rows };
}

export async function listSources(project = 'scratch') {
  const conn = await getConnection(project);
  const schema = schemaName(project);
  const result = await conn.runAndReadAll(
    `select table_name, column_name, data_type
     from information_schema.columns
     where table_schema = '${schema}'
     order by table_name, ordinal_position`
  );
  const map = new Map();
  for (const r of result.getRowObjects()) {
    const t = String(r.table_name);
    if (!map.has(t)) map.set(t, []);
    map.get(t).push({ name: String(r.column_name), type: String(r.data_type) });
  }
  return [...map.entries()].map(([name, columns]) => ({ name, columns }));
}

export async function dropSource(name, project = 'scratch') {
  const conn = await getConnection(project);
  const schema = schemaName(project);
  await conn.run(`DROP VIEW IF EXISTS "${schema}"."${name.replace(/"/g, '')}"`);
}
