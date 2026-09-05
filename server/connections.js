// Conexões GLOBAIS (DELTA §1): cadastradas uma vez, reusadas por N projetos.
// <raiz>/connections.yaml  — versionável, SEM segredos ({tipo, host, porta, db, usuário})
// <raiz>/.secrets.json     — gitignored; senhas/chaves indexadas pelo NOME da conexão
// project.yaml referencia a conexão por NOME (portabilidade: export leva só o nome).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DuckDBInstance } from '@duckdb/node-api';
import { ROOT, PROJECTS_DIR, sqlPath } from './db.js';

const CONNECTIONS_FILE = path.join(ROOT, 'connections.yaml');
const GLOBAL_SECRETS = path.join(ROOT, '.secrets.json');

// Mesmos padrões anti-segredo do project.yaml (o registro também é versionável).
const SECRET_PATTERNS = [
  { re: /\b\w+:\/\/[^\s'"@]+:[^\s'"@]+@/i, label: 'connection string com senha' },
  { re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, label: 'chave de acesso AWS' },
  { re: /\b(password|senha|secret|api_?key|access_?key|token)\s*[:=]\s*['"]?[^\s'"]{6,}/i, label: 'credencial inline' },
];

export function validateConnectionsText(yamlText) {
  const errors = [];
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(String(yamlText))) errors.push({ path: '(segredo)', message: `connections.yaml é versionável — senha entra via "Gravar senha" (write-only): ${p.label}` });
  }
  let cfg = null;
  try {
    cfg = parseYaml(String(yamlText)) || {};
  } catch (e) {
    errors.push({ path: '', message: 'YAML inválido: ' + e.message });
    return { errors, connections: null };
  }
  for (const [name, c] of Object.entries(cfg)) {
    if (!c || typeof c !== 'object') {
      errors.push({ path: name, message: 'deve ser objeto {type, host?, port?, database?, user?, path?}' });
      continue;
    }
    const type = c.type || 'duckdb';
    if (!['duckdb', 'postgres', 'mysql', 'sqlite', 's3'].includes(type)) errors.push({ path: name + '.type', message: 'duckdb | postgres | mysql | sqlite | s3' });
    if (type === 'duckdb' && !c.path) errors.push({ path: name + '.path', message: 'obrigatório para type duckdb' });
    if (type === 's3') {
      if (!c.bucket) errors.push({ path: name + '.bucket', message: 'obrigatório para type s3 (ex.: meu-bucket)' });
      if (!c.endpoint) errors.push({ path: name + '.endpoint', message: 'obrigatório para type s3 (host do MinIO, ex.: objstorage.exemplo.com)' });
      else if (/^https?:\/\//i.test(String(c.endpoint)))
        errors.push({ path: name + '.endpoint', message: 'informe só o host (o esquema vem de use_ssl), ex.: objstorage.exemplo.com' });
      if (c.url_style !== undefined && !['path', 'vhost'].includes(c.url_style)) errors.push({ path: name + '.url_style', message: 'path | vhost (MinIO usa path)' });
      if (c.use_ssl !== undefined && typeof c.use_ssl !== 'boolean') errors.push({ path: name + '.use_ssl', message: 'true | false' });
      if (c.datasets !== undefined && (!Array.isArray(c.datasets) || c.datasets.some((d) => typeof d !== 'string')))
        errors.push({ path: name + '.datasets', message: 'lista de nomes de dataset (pastas/arquivos parquet sob o prefix)' });
    }
  }
  return { errors, connections: cfg };
}

export function readConnections() {
  if (!fs.existsSync(CONNECTIONS_FILE)) return {};
  const { connections } = validateConnectionsText(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
  return connections || {};
}

export function readConnectionsText() {
  return fs.existsSync(CONNECTIONS_FILE) ? fs.readFileSync(CONNECTIONS_FILE, 'utf8') : '';
}

export function writeConnectionsText(yamlText) {
  const { errors } = validateConnectionsText(yamlText);
  if (errors.length) return { ok: false, errors };
  fs.writeFileSync(CONNECTIONS_FILE, yamlText, 'utf8');
  return { ok: true, errors: [] };
}

export function upsertConnection(name, def) {
  const cur = readConnections();
  cur[name] = def;
  return writeConnectionsText(stringifyYaml(cur));
}

export function deleteConnection(name) {
  const cur = readConnections();
  delete cur[name];
  writeConnectionsText(stringifyYaml(cur));
  // remove o segredo órfão junto (não sobra credencial de conexão apagada)
  try {
    const s = JSON.parse(fs.readFileSync(GLOBAL_SECRETS, 'utf8'));
    delete s[name];
    fs.writeFileSync(GLOBAL_SECRETS, JSON.stringify(s, null, 2), 'utf8');
  } catch {
    /* sem secrets */
  }
}

// ---- segredo global por NOME da conexão (write-only; nunca sai pela API) ----

export function writeConnectionSecret(name, value) {
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(GLOBAL_SECRETS, 'utf8'));
  } catch {
    /* novo */
  }
  cur[name] = value;
  fs.writeFileSync(GLOBAL_SECRETS, JSON.stringify(cur, null, 2), 'utf8');
  const gi = path.join(ROOT, '.gitignore');
  const line = '.secrets.json';
  const curGi = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!curGi.split(/\r?\n/).includes(line)) fs.writeFileSync(gi, (curGi ? curGi.replace(/\n?$/, '\n') : '') + line + '\n', 'utf8');
}

export function resolveConnectionSecret(name) {
  const env = process.env['STUDIO_SECRET_' + String(name).toUpperCase()];
  if (env) return env;
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_SECRETS, 'utf8'))[name];
  } catch {
    return undefined;
  }
}

export function hasConnectionSecret(name) {
  return resolveConnectionSecret(name) !== undefined;
}

/**
 * REDAÇÃO de segredos em mensagens de erro: o driver pode ecoar a connection
 * string (com senha) no erro — nada disso pode voltar pela API nem parar no
 * last_error do project.yaml.
 */
export function redactSecrets(text) {
  let out = String(text ?? '');
  try {
    const all = JSON.parse(fs.readFileSync(GLOBAL_SECRETS, 'utf8'));
    for (const v of Object.values(all)) {
      if (v && String(v).length >= 4) out = out.split(String(v)).join('***');
      // segredo composto (s3: "ACCESS_KEY:SECRET_KEY") — o driver ecoa as
      // partes separadas, então cada metade some também.
      for (const part of String(v ?? '').split(':')) {
        if (part.length >= 8) out = out.split(part).join('***');
      }
    }
  } catch {
    /* sem secrets */
  }
  // cinto e suspensório: padrões de senha em connection strings
  out = out.replace(/(password|passwd)\s*=\s*[^\s'"]+/gi, '$1=***').replace(/(\w+:\/\/[^:/\s]+):[^@\s]+@/g, '$1:***@');
  return out;
}

/**
 * Monta a string de ATTACH do postgres/mysql: o registro global tem
 * host/porta/database/usuário; o SEGREDO é só a SENHA. Se o segredo já for uma
 * connection string completa (contém :// ou =), usa como está.
 */
function attachString(conn, secret, type) {
  const s = String(secret || '');
  if (s.includes('://') || s.includes('=')) return s;
  let host = conn.host || 'localhost';
  let port = conn.port;
  if (String(host).includes(':')) {
    const [h, p] = String(host).split(':');
    host = h;
    port = port || p;
  }
  const parts = [`host=${host}`];
  if (port) parts.push(`port=${port}`);
  if (conn.database) parts.push(`${type === 'postgres' ? 'dbname' : 'database'}=${conn.database}`);
  if (conn.user) parts.push(`user=${conn.user}`);
  parts.push(`password=${s}`);
  return parts.join(' ');
}

/**
 * Roda o setup do plano (INSTALL/LOAD de extensão) com resiliência: download
 * corrompido ("not a GZIP stream" — proxy/queda no meio) ganha UMA nova
 * tentativa com FORCE INSTALL (re-baixa por cima do cache) e erro acionável.
 */
export async function runSetup(c, plan) {
  for (const s of plan.setup) {
    try {
      await c.run(s);
    } catch (e) {
      if (/gzip/i.test(String(e.message)) && /^INSTALL/i.test(s)) {
        try {
          await c.run('FORCE ' + s);
        } catch (e2) {
          throw new Error(
            `Falha ao baixar a extensão DuckDB (${s}): o download veio corrompido ou foi bloqueado ` +
              `(proxy/firewall interceptando extensions.duckdb.org?). Tente de novo com a rede liberada. ` +
              `Detalhe: ${redactSecrets(String(e2.message).split('\n')[0])}`
          );
        }
      } else {
        throw new Error(redactSecrets(e.message));
      }
    }
  }
}

// ---- Object storage S3/MinIO (type: s3) ----
// O bucket privado NÃO pode virar mount (o publish ☁ emitiria uma URL s3://
// que o navegador não autentica) — entra como CONEXÃO, extraída para parquet
// local pela view materializada. Não há banco para anexar: `ext` é um
// :memory: onde cada dataset do prefix vira uma VIEW read_parquet.

const s3Base = (conn) => {
  const prefix = String(conn.prefix || '').replace(/^\/+|\/+$/g, '');
  return `s3://${String(conn.bucket).replace(/^\/+|\/+$/g, '')}${prefix ? '/' + prefix : ''}`;
};

/** Nome de view seguro a partir do nome do dataset no bucket. */
const s3ViewName = (ds) => String(ds).replace(/\.parquet$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');

function s3SecretSql(name, conn, secret) {
  const idx = String(secret).indexOf(':');
  if (idx <= 0) throw new Error(`credencial da conexão "${name}" deve ser "ACCESS_KEY:SECRET_KEY" — regrave em "🔑 Senha"`);
  const keyId = String(secret).slice(0, idx);
  const key = String(secret).slice(idx + 1);
  const q = (v) => String(v).replace(/'/g, "''");
  const opts = [
    `TYPE S3`,
    `KEY_ID '${q(keyId)}'`,
    `SECRET '${q(key)}'`,
    `ENDPOINT '${q(conn.endpoint)}'`,
    `URL_STYLE '${conn.url_style === 'vhost' ? 'vhost' : 'path'}'`,
    `USE_SSL ${conn.use_ssl === false ? 'false' : 'true'}`,
    `REGION '${q(conn.region || 'us-east-1')}'`,
  ];
  return `CREATE OR REPLACE SECRET studio_${s3ViewName(name)} (${opts.join(', ')})`;
}

/**
 * Descobre os datasets sob o prefix e publica cada um como view em `ext`.
 * `datasets:` declarado no registro pula a descoberta (listagem de bucket
 * grande é cara); senão faz UM glob de parquet e agrupa por primeira pasta.
 */
async function s3Publish(conn, c) {
  const base = s3Base(conn);
  let names = Array.isArray(conn.datasets) ? conn.datasets.slice() : null;
  const folders = new Set();
  if (!names) {
    let rows;
    try {
      rows = await c.runAndReadAll(`select file from glob('${base.replace(/'/g, "''")}/**/*.parquet')`);
    } catch (e) {
      // 403 na LISTAGEM com credencial válida = service account sem
      // s3:ListBucket. Erro cru ("Access Denied") manda o usuário caçar a
      // credencial errada; o problema é de POLÍTICA.
      if (/403|AccessDenied/i.test(String(e.message))) {
        throw new Error(
          `sem permissão para LISTAR ${base} (HTTP 403). A credencial pode estar válida e ainda assim não ` +
            `enumerar o bucket: a service account precisa de s3:ListBucket. Peça essa permissão ao time do ` +
            `object storage, ou declare "datasets:" no registro da conexão com os nomes exatos dos objetos ` +
            `(nesse caso só arquivos .parquet avulsos funcionam — pasta particionada também exige listagem).`
        );
      }
      throw e;
    }
    const found = new Set();
    for (const r of rows.getRowObjects()) {
      const rel = String(r.file).slice(base.length).replace(/^\/+/, '');
      const seg = rel.split('/');
      if (seg.length > 1) {
        found.add(seg[0]);
        folders.add(seg[0]);
      } else found.add(seg[0]);
    }
    names = [...found];
  }
  const published = [];
  for (const ds of names) {
    const view = s3ViewName(ds);
    // pasta = dataset particionado (hive) · arquivo solto = parquet único
    const isFile = /\.parquet$/i.test(String(ds)) && !folders.has(ds);
    const url = `${base}/${String(ds).replace(/^\/+/, '')}${isFile ? '' : '/**/*.parquet'}`;
    const opts = isFile ? '' : ', hive_partitioning => true, union_by_name => true';
    await c.run(`CREATE OR REPLACE VIEW ext."${view}" AS SELECT * FROM read_parquet('${url.replace(/'/g, "''")}'${opts})`);
    published.push(view);
  }
  if (!published.length) throw new Error(`nenhum parquet encontrado em ${base} — confira bucket/prefix (ou declare "datasets:" no registro)`);
  return published;
}

// ---- ATTACH plan (compartilhado com materialize.js) ----

export function attachPlanFor(name) {
  const conn = readConnections()[name];
  if (!conn) throw new Error(`conexão "${name}" não registrada — cadastre no menu Conexões`);
  const type = conn.type || 'duckdb';
  if (type === 's3') {
    const secret = resolveConnectionSecret(name);
    if (!secret) throw new Error(`credencial da conexão "${name}" não gravada — use "🔑 Senha" no menu Conexões (formato ACCESS_KEY:SECRET_KEY)`);
    return {
      setup: ['INSTALL httpfs', 'LOAD httpfs', s3SecretSql(name, conn, secret)],
      attach: `ATTACH ':memory:' AS ext`,
      after: (c) => s3Publish(conn, c),
    };
  }
  if (type === 'duckdb') {
    const target = conn.path;
    const abs = path.isAbsolute(String(target)) ? String(target) : path.resolve(ROOT, String(target));
    return { setup: [], attach: `ATTACH '${sqlPath(abs)}' AS ext (READ_ONLY)` };
  }
  const secret = resolveConnectionSecret(name);
  if (!secret) throw new Error(`senha/credencial da conexão "${name}" não gravada — use "🔑 Senha" no menu Conexões`);
  // sqlite: o segredo é o caminho do arquivo; postgres/mysql: monta a string
  // dos campos do cadastro + senha (ou usa a connection string completa).
  const str = type === 'sqlite' ? String(secret) : attachString(conn, secret, type);
  return {
    setup: [`INSTALL ${type}`, `LOAD ${type}`],
    attach: `ATTACH '${str.replace(/'/g, "''")}' AS ext (TYPE ${type}, READ_ONLY)`,
  };
}

/**
 * Instância EFÊMERA de extração. `:memory:` puro não tem para onde derramar:
 * um GROUP BY que não cabe na RAM mata o processo em vez de degradar — e o
 * catch nem roda, então a falha some sem `last_error`. Com temp_directory o
 * DuckDB paginas para disco e a extração grande só fica mais lenta.
 */
export async function createExtractionInstance() {
  const tmp = path.join(os.tmpdir(), 'studio-duckdb-spill');
  try {
    fs.mkdirSync(tmp, { recursive: true });
  } catch {
    /* sem temp: cai no comportamento antigo */
  }
  return DuckDBInstance.create(':memory:', { temp_directory: tmp });
}

/**
 * Abre a fonte externa numa conexão efêmera: setup (extensão/segredo) →
 * ATTACH → `after` (s3 publica as views em `ext`). Ponto ÚNICO por onde a
 * credencial encosta no DuckDB — e onde o erro é redigido.
 */
export async function openExternal(c, plan) {
  await runSetup(c, plan);
  try {
    await c.run(plan.attach);
    if (plan.after) await plan.after(c);
  } catch (e) {
    throw new Error(redactSecrets(e.message));
  }
}

/** Testar conexão (DELTA §2): ATTACH numa instância efêmera. */
export async function testConnection(name) {
  const plan = attachPlanFor(name);
  const inst = await createExtractionInstance();
  const c = await inst.connect();
  try {
    await openExternal(c, plan);
    return { ok: true };
  } finally {
    try {
      c.closeSync?.();
    } catch {
      /* efêmera */
    }
  }
}

/** ▶ Preview (DELTA §3 [P]): valida a query sem extrair tudo (100 linhas). */
export async function previewQuery(name, query) {
  const plan = attachPlanFor(name);
  const inst = await createExtractionInstance();
  const c = await inst.connect();
  try {
    await openExternal(c, plan);
    const r = await c.runAndReadAll(`select * from (${String(query).replace(/;\s*$/, '')}) t limit 100`);
    const norm = (v) => {
      if (typeof v === 'bigint') return v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v.toString();
      if (v === null || v === undefined) return v;
      if (typeof v === 'object') return String(v); // DECIMAL/DATE do DuckDB têm toString fiel
      return v;
    };
    return {
      columns: r.columnNames(),
      rows: r.getRowObjects().map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, norm(v)]))),
    };
  } finally {
    try {
      c.closeSync?.();
    } catch {
      /* efêmera */
    }
  }
}

/** Quem usa a conexão (DELTA §2): varre todos os project.yaml → projeto → fontes. */
export function connectionUsage(name) {
  const out = [];
  if (!fs.existsSync(PROJECTS_DIR)) return out;
  for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(PROJECTS_DIR, d.name, 'project.yaml');
    if (!fs.existsSync(f)) continue;
    try {
      const cfg = parseYaml(fs.readFileSync(f, 'utf8')) || {};
      const sources = Object.entries(cfg.materialized || {})
        .filter(([, m]) => m?.connection === name)
        .map(([n]) => n);
      if (sources.length) out.push({ project: d.name, sources });
    } catch {
      /* yaml quebrado não derruba a varredura */
    }
  }
  return out;
}
