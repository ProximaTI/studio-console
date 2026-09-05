import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { PROJECTS_DIR, ROOT, ensureProjectSkeleton, dropProjectSchema, registerProjectSources } from '../db.js';
import { readSettings } from '../settings.js';
import { buildPublishedHtml, buildPublishedApp } from '../publish.js';
import { checkPublishPolicies } from '../semantic.js';
import { resolveQueries, findLiveScan } from '../publish/queries.js';
import { parseBlocks } from '../../shared/parser.js';

// Scan ao vivo (ATTACH/postgres_scan…) em página = erro de compilação (Fontes §1).
function liveScanError(mdSource, queriesDir) {
  const q = findLiveScan(resolveQueries(parseBlocks(mdSource), queriesDir));
  return q ? `A query "${q}" usa scan AO VIVO (ATTACH/postgres_scan…) — páginas só leem parquet materializado. Extraia via view materializada (↻) e aponte a query para a fonte local.` : null;
}
import sourcesRouter from './sources.js';
import modelsRouter from './models.js';
import semanticRouter from './semantic.js';
import { configRouter, secretsRouter } from './config.js';
import { deployDirFor } from '../projectConfig.js';

const router = Router();
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// Sub-recursos escopados ao projeto.
router.use('/:project/sources', sourcesRouter);
router.use('/:project/models', modelsRouter);
router.use('/:project/semantic', semanticRouter);
router.use('/:project/config', configRouter);
router.use('/:project/secrets', secretsRouter);

// Cria fonte "View materializada" (DELTA §3): conexão → query → nome →
// 1ª materialização + registro. A query persiste no project.yaml.
router.post('/:project/materialized', async (req, res) => {
  try {
    const { createMaterialized } = await import('../materialize.js');
    res.json({ ok: true, ...(await createMaterialized(req.params.project, req.body || {})) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ↻ de view materializada (arquiteto): ATTACH efêmero → COPY → parquet local.
router.post('/:project/materialized/:name/refresh', async (req, res) => {
  try {
    const { refreshMaterialized } = await import('../materialize.js');
    res.json({ ok: true, ...(await refreshMaterialized(req.params.project, req.params.name)) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Cria a entrada de MOUNT no project.yaml (edição cirúrgica) e registra as fontes.
router.post('/:project/mounts', async (req, res) => {
  try {
    if (req.params.project === 'scratch') return res.status(400).json({ error: 'Mounts exigem projeto nomeado.' });
    const { name, base_url, prefix } = req.body || {};
    if (!name || !base_url) return res.status(400).json({ error: 'name e base_url são obrigatórios' });
    const safe = String(name).trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const { parseDocument } = await import('yaml');
    const f = path.join(PROJECTS_DIR, req.params.project.replace(/[^a-zA-Z0-9_-]/g, '_'), 'project.yaml');
    const doc = parseDocument(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
    doc.setIn(['mounts', safe, 'base_url'], String(base_url));
    if (prefix) doc.setIn(['mounts', safe, 'prefix'], String(prefix));
    fs.writeFileSync(f, doc.toString(), 'utf8');
    const { registerMountSources } = await import('../materialize.js');
    res.json({ ok: true, mount: safe, ...(await registerMountSources(req.params.project, safe)) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Mounts: lista os parquets do bucket/pasta e registra como fontes do projeto.
router.get('/:project/mounts/:name/list', async (req, res) => {
  try {
    const { listMountFiles } = await import('../materialize.js');
    res.json({ files: listMountFiles(req.params.project, req.params.name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// Serve os arquivos de um mount de PASTA LOCAL por HTTP (o ☁ publicado lê
// daqui — sobrescrever o arquivo na pasta reflete no reload do app).
router.get('/:project/mountfs/:mount/*', async (req, res) => {
  try {
    const { listMountFiles } = await import('../materialize.js');
    const files = listMountFiles(req.params.project, req.params.mount);
    const wanted = String(req.params[0] || '');
    const f = files.find((x) => x.file === wanted);
    if (!f) return res.status(404).send('Arquivo não encontrado no mount');
    res.type('application/octet-stream');
    res.send(fs.readFileSync(f.url));
  } catch (e) {
    res.status(400).send(e.message);
  }
});

router.post('/:project/mounts/:name/register', async (req, res) => {
  try {
    const { registerMountSources } = await import('../materialize.js');
    res.json({ ok: true, ...(await registerMountSources(req.params.project, req.params.name)) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// Diretório de deploy: project.yaml deploy.dir do PROJETO, com fallback ao
// settings global (transição — spec Fase Fontes §3). Criado sob demanda.
function publishedDir(project) {
  const resolved = deployDirFor(project);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

// Garante que o caminho resolvido fica dentro de base (anti path-traversal).
function safeJoin(base, target) {
  const root = path.resolve(base);
  const p = path.resolve(root, target);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Caminho inválido');
  return p;
}

// Projetos externos (layout Evidence on-premise: <root>/pages + <root>/queries).
// Mapeados em server/external-projects.json; raiz relativa ao diretório do server.
const EXTERNAL_FILE = path.join(ROOT, 'server', 'external-projects.json');
function externalProjects() {
  try {
    return JSON.parse(fs.readFileSync(EXTERNAL_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Resolve os diretórios do projeto (layout Evidence: pages/ + sources/ + queries/).
// Fallback legado: projeto sem pages/ mantém os .md na raiz.
export function projectDirs(project) {
  const ext = externalProjects()[project];
  if (ext) {
    const root = path.resolve(ROOT, 'server', ext.root || '.');
    return {
      root,
      pagesDir: path.join(root, ext.pages || 'pages'),
      queriesDir: path.join(root, ext.queries || 'queries'),
      sourcesDir: ext.sources ? path.resolve(root, ext.sources) : null,
      external: true,
    };
  }
  const dir = safeJoin(PROJECTS_DIR, project);
  const pages = path.join(dir, 'pages');
  return {
    root: dir,
    pagesDir: fs.existsSync(pages) ? pages : dir,
    queriesDir: path.join(dir, 'queries'),
    sourcesDir: path.join(dir, 'sources'),
    external: false,
  };
}

router.get('/', (_req, res) => {
  const projects = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const name of Object.keys(externalProjects())) {
    if (!projects.includes(name) && fs.existsSync(projectDirs(name).pagesDir)) projects.push(name);
  }
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  safeJoin(PROJECTS_DIR, safe); // valida o nome (anti path-traversal)
  ensureProjectSkeleton(safe, name); // pages/index.md + sources/ + queries/
  res.json({ name: safe });
});

// Promove um projeto (tipicamente o scratch) para um nome definitivo:
// renomeia o diretório, derruba o schema antigo e re-registra as fontes.
router.post('/:project/promote', async (req, res) => {
  try {
    const from = req.params.project;
    if (externalProjects()[from]) return res.status(400).json({ error: 'Projeto externo não pode ser renomeado' });
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fromDir = safeJoin(PROJECTS_DIR, from);
    const toDir = safeJoin(PROJECTS_DIR, safe);
    if (!fs.existsSync(fromDir)) return res.status(404).json({ error: 'Projeto não encontrado' });
    if (safe !== from && fs.existsSync(toDir)) return res.status(400).json({ error: `Já existe um projeto "${safe}"` });
    fs.renameSync(fromDir, toDir);
    await dropProjectSchema(from); // as views antigas apontavam para o caminho antigo
    await registerProjectSources(safe, path.join(toDir, 'sources'));
    if (from === 'scratch') ensureProjectSkeleton('scratch', 'Rascunho'); // rascunho renasce vazio
    res.json({ name: safe });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Exclui um projeto interno (diretório + schema). Externos são só configuração.
router.delete('/:project', async (req, res) => {
  try {
    const p = req.params.project;
    if (externalProjects()[p]) return res.status(400).json({ error: 'Projeto externo não pode ser excluído pela console' });
    const dir = safeJoin(PROJECTS_DIR, p);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Projeto não encontrado' });
    fs.rmSync(dir, { recursive: true, force: true });
    await dropProjectSchema(p);
    if (p === 'scratch') ensureProjectSkeleton('scratch', 'Rascunho'); // rascunho sempre existe
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lista .md recursivamente (caminhos relativos com / para subpastas).
function listMd(dir, base = '') {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out = out.concat(listMd(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

router.get('/:project/files', (req, res) => {
  try {
    const { pagesDir } = projectDirs(req.params.project);
    if (!fs.existsSync(pagesDir)) return res.status(404).json({ error: 'Projeto não encontrado' });
    res.json({ files: listMd(pagesDir) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:project/file', (req, res) => {
  try {
    const file = safeJoin(projectDirs(req.params.project).pagesDir, String(req.query.path || ''));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    res.json({ content: fs.readFileSync(file, 'utf8') });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Lista os .sql do diretório queries/ do projeto (aba Queries da console).
router.get('/:project/query-files', (req, res) => {
  try {
    const { queriesDir } = projectDirs(req.params.project);
    if (!fs.existsSync(queriesDir)) return res.json({ files: [] });
    const files = fs
      .readdirSync(queriesDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.sql'))
      .map((d) => d.name)
      .sort();
    res.json({ files });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Lê um .sql referenciado no frontmatter (queries: - nome: arquivo.sql).
router.get('/:project/query-file', (req, res) => {
  try {
    const { queriesDir } = projectDirs(req.params.project);
    const file = safeJoin(queriesDir, String(req.query.path || ''));
    if (!fs.existsSync(file))
      return res.status(404).json({ error: 'não encontrado em queries/ — crie o arquivo ou use um bloco ```sql inline' });
    res.json({ content: fs.readFileSync(file, 'utf8') });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Grava um .sql do diretório queries/ (edição pela console).
router.put('/:project/query-file', (req, res) => {
  try {
    const { path: rel, content } = req.body || {};
    const { queriesDir } = projectDirs(req.params.project);
    const file = safeJoin(queriesDir, String(rel || ''));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content ?? '', 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:project/file', async (req, res) => {
  try {
    const { path: rel, content } = req.body || {};
    const file = safeJoin(projectDirs(req.params.project).pagesDir, String(rel || ''));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    fs.writeFileSync(file, content ?? '', 'utf8');
    // F6 D32 (sync automático): página POSSUÍDA por uma spec devolve os BLOCOS
    // para ela. TRANSACIONAL (revisão F6, achado 1): se o sync falhar, a
    // gravação da página é DESFEITA e o erro volta explícito — nunca
    // {ok:true} com a spec para trás.
    let specSynced = null;
    try {
      const { syncPageToSpec } = await import('../reports.js');
      specSynced = await syncPageToSpec(req.params.project, String(rel || ''));
    } catch (e) {
      try {
        if (prev === null) fs.rmSync(file, { force: true });
        else fs.writeFileSync(file, prev, 'utf8');
      } catch {
        /* restauração é melhor esforço */
      }
      return res.status(500).json({
        error: `A página NÃO foi salva: falha ao sincronizar a spec do relatório (${e.message}). A gravação foi desfeita — corrija a spec (aba Diagnósticos) e salve de novo.`,
      });
    }
    res.json({ ok: true, ...(specSynced ? { specSynced } : {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:project/file', (req, res) => {
  try {
    const file = safeJoin(projectDirs(req.params.project).pagesDir, String(req.query.path || ''));
    if (fs.existsSync(file)) fs.rmSync(file);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:project/file', (req, res) => {
  try {
    // Permite subpastas (/) e colchetes de páginas parametrizadas ([param]).
    const raw = String((req.body || {}).path || '')
      .replace(/\\/g, '/')
      .split('/')
      .map((seg) => seg.replace(/[^a-zA-Z0-9_.\[\]-]/g, '_'))
      .filter(Boolean)
      .join('/');
    const name = raw.endsWith('.md') ? raw : raw + '.md';
    const file = safeJoin(projectDirs(req.params.project).pagesDir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      const title = path.basename(name, '.md');
      fs.writeFileSync(file, `# ${title}\n\n`, 'utf8');
    }
    res.json({ file: name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Publica uma página: congela os dados (snapshot) e gera um HTML único offline.
router.post('/:project/publish', async (req, res) => {
  try {
    const project = req.params.project;
    const rel = String((req.body || {}).path || '');
    // O snapshot pré-computa dados; não há como resolver ?param= em build-time aqui.
    if (path.basename(rel).startsWith('[')) {
      return res.json({ error: 'Página parametrizada: use "☁ Publish app" — o snapshot 📦 não suporta ?param= na URL.' });
    }
    const file = safeJoin(projectDirs(project).pagesDir, rel);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const mdSource = fs.readFileSync(file, 'utf8');

    // Políticas (F3 §6): dimensão internal não sai em publish público.
    const pol = checkPublishPolicies(project, mdSource, (req.body || {}).visibility || 'public');
    if (!pol.ok) return res.status(400).json({ error: pol.error });
    const live = liveScanError(mdSource, projectDirs(project).queriesDir);
    if (live) return res.status(400).json({ error: live });

    const settings = readSettings();

    const html = await buildPublishedHtml(project, path.basename(rel), mdSource, settings, projectDirs(project).queriesDir);
    const outDir = path.join(publishedDir(project), project);
    fs.mkdirSync(outDir, { recursive: true });
    const outName = path.basename(rel).replace(/\.md$/, '') + '.html';
    const outPath = path.join(outDir, outName);
    fs.writeFileSync(outPath, html, 'utf8');

    res.json({ ok: true, path: outPath, file: outName, bytes: Buffer.byteLength(html) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Baixa o HTML publicado.
router.get('/:project/published/:file', (req, res) => {
  try {
    const f = safeJoin(path.join(publishedDir(req.params.project), req.params.project), req.params.file);
    if (!fs.existsSync(f)) return res.status(404).send('Não publicado ainda');
    res.type('html').send(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    res.status(400).send(e.message);
  }
});

// Publica no modo "dados separados": Parquet + DuckDB-WASM (Universal SQL no cliente).
router.post('/:project/publish-app', async (req, res) => {
  try {
    const project = req.params.project;
    const rel = String((req.body || {}).path || '');
    const baseUrl = (req.body || {}).baseUrl || '';
    const file = safeJoin(projectDirs(project).pagesDir, rel);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const mdSource = fs.readFileSync(file, 'utf8');

    // Políticas (F3 §6): dimensão internal não sai em publish público.
    const pol = checkPublishPolicies(project, mdSource, (req.body || {}).visibility || 'public');
    if (!pol.ok) return res.status(400).json({ error: pol.error });
    const live = liveScanError(mdSource, projectDirs(project).queriesDir);
    if (live) return res.status(400).json({ error: live });

    const settings = readSettings();

    // Página parametrizada (dir/[param].md) publica com o nome do DIRETÓRIO:
    // unidade/[unidade].md -> pacote "unidade-app" (links /unidade/VALOR/ mapeiam direto).
    const base = path.basename(rel).replace(/\.md$/, '');
    const segs = rel.replace(/\\/g, '/').split('/').filter(Boolean);
    const page = base.startsWith('[') && segs.length > 1 ? segs[segs.length - 2] : base.replace(/[\[\]]/g, '');
    const outDir = path.join(publishedDir(project), project, page + '-app');
    fs.mkdirSync(outDir, { recursive: true });
    const dirs = projectDirs(project);
    const info = await buildPublishedApp(project, path.basename(rel), mdSource, settings, baseUrl, outDir, dirs.queriesDir, dirs.pagesDir);

    res.json({ ok: true, dir: outDir, page, previewUrl: `/api/projects/${project}/app/${page}/app.html`, ...info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve os arquivos do pacote publicado (app.html, duckdb/*, data/*).
router.get('/:project/app/:page/*', (req, res) => {
  try {
    let baseDir = path.join(publishedDir(req.params.project), req.params.project, req.params.page + '-app');
    // Links entre apps publicados usam '../<página>-app/...' (forma do disco);
    // aceita também esse formato quando chega pela rota de preview.
    if (!fs.existsSync(baseDir) && req.params.page.endsWith('-app')) {
      baseDir = path.join(publishedDir(req.params.project), req.params.project, req.params.page);
    }
    const rest = req.params[0] || 'app.html';
    const f = safeJoin(baseDir, rest);
    if (!fs.existsSync(f)) return res.status(404).send('Não encontrado');
    const ext = path.extname(f).toLowerCase();
    const types = {
      '.html': 'text/html',
      '.mjs': 'text/javascript',
      '.js': 'text/javascript',
      '.wasm': 'application/wasm',
      '.parquet': 'application/octet-stream',
    };
    if (types[ext]) res.type(types[ext]);
    res.send(fs.readFileSync(f));
  } catch (e) {
    res.status(400).send(e.message);
  }
});

export default router;
