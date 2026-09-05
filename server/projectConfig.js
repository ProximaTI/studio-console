// Configuração POR PROJETO (Fase Fontes, spec §3): project.yaml versionável
// (fontes, mounts, deploy — SEM segredos) + .secrets.json (gitignored,
// write-only pela API, jamais servido ao browser).
//
// O validador RECUSA gravar segredo inline no project.yaml — o acidente mais
// provável e mais caro (spec §3 [P]) é bloqueado na origem, não em CI.
import path from 'node:path';
import fs from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PROJECTS_DIR, ROOT } from './db.js';
import { readSettings } from './settings.js';
import { readConnections } from './connections.js';

const CONFIG_FILE = 'project.yaml';
const SECRETS_FILE = '.secrets.json';

function projectRoot(project) {
  const safe = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROJECTS_DIR, safe);
}

// Padrões de segredo que NÃO podem aparecer no project.yaml (versionável).
const SECRET_PATTERNS = [
  { re: /\b\w+:\/\/[^\s'"@]+:[^\s'"@]+@/i, label: 'connection string com senha (user:senha@host)' },
  { re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, label: 'chave de acesso AWS' },
  { re: /\b(password|senha|secret|api_?key|access_?key|token)\s*[:=]\s*['"]?[^\s'"]{6,}/i, label: 'credencial inline (password/secret/key/token)' },
];

/** Valida o TEXTO do project.yaml: estrutura + ausência de segredos. */
export function validateProjectConfig(yamlText) {
  const errors = [];
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(String(yamlText))) {
      errors.push({ path: '(segredo)', message: `project.yaml é versionável — mova para .secrets.json e use credentials_ref: ${p.label}` });
    }
  }
  let cfg = null;
  try {
    cfg = parseYaml(String(yamlText)) || {};
  } catch (e) {
    errors.push({ path: '', message: 'YAML inválido: ' + e.message });
    return { errors, config: null };
  }
  for (const [name, c] of Object.entries(cfg.connections || {})) {
    if (!c || typeof c !== 'object') {
      errors.push({ path: `connections.${name}`, message: 'deve ser objeto' });
      continue;
    }
    // duckdb local usa path (não é segredo); os demais exigem credentials_ref.
    if ((c.type || 'duckdb') === 'duckdb') {
      if (!c.path && !c.credentials_ref) errors.push({ path: `connections.${name}.path`, message: 'obrigatório para type duckdb' });
    } else if (!c.credentials_ref) {
      errors.push({ path: `connections.${name}.credentials_ref`, message: 'obrigatório — o segredo vive em .secrets.json' });
    }
  }
  for (const [name, m] of Object.entries(cfg.materialized || {})) {
    if (!m?.connection) errors.push({ path: `materialized.${name}.connection`, message: 'obrigatório (nome de uma conexão)' });
    else if (!(cfg.connections || {})[m.connection] && !readConnections()[m.connection])
      errors.push({ path: `materialized.${name}.connection`, message: `conexão "${m.connection}" não registrada (menu Conexões) nem declarada no projeto` });
    if (!m?.query) errors.push({ path: `materialized.${name}.query`, message: 'obrigatório (SQL de extração)' });
  }
  for (const [name, mt] of Object.entries(cfg.mounts || {})) {
    if (!mt?.base_url) errors.push({ path: `mounts.${name}.base_url`, message: 'obrigatório (http(s)://, s3:// ou caminho de rede)' });
  }
  return { errors, config: cfg };
}

/** Config do projeto (objeto) — {} se não existe. */
export function readProjectConfig(project) {
  const f = path.join(projectRoot(project), CONFIG_FILE);
  if (!fs.existsSync(f)) return {};
  const { config } = validateProjectConfig(fs.readFileSync(f, 'utf8'));
  return config || {};
}

export function readProjectConfigText(project) {
  const f = path.join(projectRoot(project), CONFIG_FILE);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

/** Grava o project.yaml SE passar no validador. Retorna {ok, errors}. */
export function writeProjectConfigText(project, yamlText) {
  const { errors } = validateProjectConfig(yamlText);
  if (errors.length) return { ok: false, errors };
  fs.mkdirSync(projectRoot(project), { recursive: true });
  fs.writeFileSync(path.join(projectRoot(project), CONFIG_FILE), yamlText, 'utf8');
  return { ok: true, errors: [] };
}

/** Merge de patch (objeto) na config — serializa de volta como YAML. */
export function patchProjectConfig(project, patch) {
  const cur = readProjectConfig(project);
  const next = { ...cur, ...patch };
  const text = stringifyYaml(next);
  return writeProjectConfigText(project, text);
}

// ---- Segredos (.secrets.json): write-only pela API; só o servidor resolve. ----

export function writeSecret(project, ref, value) {
  const f = path.join(projectRoot(project), SECRETS_FILE);
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    /* novo */
  }
  cur[ref] = value;
  fs.writeFileSync(f, JSON.stringify(cur, null, 2), 'utf8');
  // .gitignore do projeto garante que o segredo não versiona junto
  const gi = path.join(projectRoot(project), '.gitignore');
  const line = SECRETS_FILE;
  const curGi = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!curGi.split(/\r?\n/).includes(line)) fs.writeFileSync(gi, (curGi ? curGi.replace(/\n?$/, '\n') : '') + line + '\n', 'utf8');
}

/** Resolve um segredo por ref — USO INTERNO do servidor, nunca via rota. */
export function resolveSecret(project, ref) {
  if (process.env['STUDIO_SECRET_' + String(ref).toUpperCase()]) return process.env['STUDIO_SECRET_' + String(ref).toUpperCase()];
  const f = path.join(projectRoot(project), SECRETS_FILE);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))[ref];
  } catch {
    return undefined;
  }
}

/** Refs existentes (só os NOMES — nunca os valores). */
export function listSecretRefs(project) {
  const f = path.join(projectRoot(project), SECRETS_FILE);
  try {
    return Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')));
  } catch {
    return [];
  }
}

/** deploy.dir do projeto com fallback ao settings global (transição, spec §3). */
export function deployDirFor(project) {
  const cfg = readProjectConfig(project);
  const dir = String(cfg?.deploy?.dir || readSettings().deploy.dir || 'published').trim() || 'published';
  return path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
}
