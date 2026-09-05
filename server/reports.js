// F6 — Spec-Driven Reports: a spec (reports/<slug>.md, "SPEC.md") é a fonte
// declarada do relatório; páginas são BUILD. Formato D33: markdown livre
// (narrativa dos humanos) + o PRIMEIRO fence ```yaml com o ReportSpec
// (contrato ReportPlan v1 + name + prose: por página).
// Regra da verdade D32: reedição estruturada sincroniza o bloco na spec;
// edição livre vira DIVERGÊNCIA com resolução explícita — nunca clobber.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml';
import { PROJECTS_DIR } from './db.js';
import { loadCatalogs, factColumnsFor } from './semantic.js';
import { validateReportPlan } from '../shared/reportPlan.js';
import { compileReport, outPathOf } from '../shared/reportCompiler.js';
import { findViewblocks } from '../shared/viewblock.js';
import { applyReport } from './reportApply.js';
import { projectDirs } from './routes/projects.js';

export function reportsDir(project) {
  const safe = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROJECTS_DIR, safe, 'reports');
}

/**
 * Fence do contrato. Delimitador CANÔNICO: ```studio-report — inequívoco (a
 * narrativa pode conter exemplos ```yaml sem virar contrato por engano).
 * Compat: sem fence studio-report, cai no PRIMEIRO ```yaml (specs antigas).
 */
export function extractSpecFence(md) {
  const s = String(md);
  let lang = 'studio-report';
  let m = s.match(/```studio-report[^\S\n]*\n([\s\S]*?)\n```/);
  if (!m) {
    lang = 'yaml';
    m = s.match(/```yaml[^\S\n]*\n([\s\S]*?)\n```/);
  }
  if (!m) return null;
  // Spec gravada com CRLF (editor de Windows): o \r antes do ``` de fechamento
  // fica DENTRO do capturado e o parser YAML o lê como escalar solto na última
  // linha — "Unexpected scalar at node end". Normaliza a captura; o `before`/
  // `after` preservam o resto do arquivo byte a byte.
  return { yamlText: m[1].replace(/\r\n/g, '\n').replace(/\r$/, ''), before: s.slice(0, m.index), after: s.slice(m.index + m[0].length), lang };
}

/** Reembute o fence editado preservando narrativa e o delimitador usado. */
function embedFence(fence, doc) {
  return fence.before + '```' + fence.lang + '\n' + String(doc).replace(/\n$/, '') + '\n```' + fence.after;
}

/** Carrega todas as specs do projeto (validação estrutural + posse D34). */
export function loadReports(project) {
  const dir = reportsDir(project);
  if (!fs.existsSync(dir)) return [];
  const catalogs = loadCatalogs(project);
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const slug = f.replace(/\.md$/, '');
    const fence = extractSpecFence(content);
    let spec = null;
    let errors = [];
    if (!fence) errors = [{ path: '', message: 'spec sem fence de contrato — o contrato vive num bloco ```studio-report (ou ```yaml, legado)' }];
    else {
      try {
        spec = parseYaml(fence.yamlText);
      } catch (e) {
        errors = [{ path: '', message: 'YAML inválido no fence: ' + e.message }];
      }
      if (spec) {
        if (!spec.name) errors.push({ path: 'name', message: 'obrigatório (identifica o relatório)' });
        const entry = catalogs.find((c) => c.valid && c.model === spec.catalog);
        errors.push(...validateReportPlan(spec, { catalog: entry ? entry.catalog : null }));
      }
    }
    out.push({ slug, file: f, content, spec: errors.length ? spec : spec, errors, valid: errors.length === 0 });
  }
  // D34: cada página pertence a NO MÁXIMO uma spec
  const donos = new Map();
  for (const r of out) {
    for (const pg of r.spec?.pages || []) {
      const p = outPathOf(pg);
      if (donos.has(p)) {
        const msg = { path: 'pages', message: `página ${p} já pertence ao relatório "${donos.get(p)}" (posse única)` };
        r.errors.push(msg);
        r.valid = false;
      } else donos.set(p, r.slug);
    }
  }
  return out;
}

export function getReport(project, slug) {
  return loadReports(project).find((r) => r.slug === slug) || null;
}

/** Dono de uma página (slug da spec) ou null — usado pelo sync D32. */
export function pageOwner(project, rel) {
  const clean = String(rel).replace(/\\/g, '/');
  for (const r of loadReports(project)) {
    if (!r.valid) continue;
    if ((r.spec.pages || []).some((pg) => outPathOf(pg) === clean)) return r.slug;
  }
  return null;
}

// Impressão digital do último build (por spec × página): é o que permite
// distinguir "PÁGINA editada depois do build" (divergente — gate) de "SPEC
// editada depois do build" (pendente — rebuild livre). Byte-diff sozinho é
// simétrico e não sabe quem mudou.
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const buildFile = (project) => path.join(reportsDir(project), '.build.json');

function readBuildRecord(project) {
  try {
    return JSON.parse(fs.readFileSync(buildFile(project), 'utf8'));
  } catch {
    return {};
  }
}

export function recordBuild(project, slug, pagePaths) {
  const { pagesDir } = projectDirs(project);
  const rec = readBuildRecord(project);
  rec[slug] = rec[slug] || {};
  for (const rel of pagePaths) {
    const p = path.join(pagesDir, rel);
    if (fs.existsSync(p)) rec[slug][rel] = sha1(fs.readFileSync(p, 'utf8'));
  }
  fs.mkdirSync(reportsDir(project), { recursive: true });
  fs.writeFileSync(buildFile(project), JSON.stringify(rec, null, 2), 'utf8');
}

/** Exclusão da spec limpa o registro derivado — slug recriado nasce limpo. */
export function clearBuildRecord(project, slug) {
  const rec = readBuildRecord(project);
  if (rec[slug]) {
    delete rec[slug];
    try {
      fs.writeFileSync(buildFile(project), JSON.stringify(rec, null, 2), 'utf8');
    } catch {
      /* registro derivado — melhor esforço */
    }
  }
}

/**
 * Status (F6): quebrado | desatualizado (marcador com catalogHash antigo) |
 * divergente (PÁGINA mudou desde o último build — resolução explícita) |
 * pendente (falta construir OU a SPEC mudou — rebuild livre) | ok.
 */
export async function reportStatus(project, entry) {
  if (!entry.valid) return { state: 'quebrado', errors: entry.errors, pages: [] };
  const cat = loadCatalogs(project).find((c) => c.valid && c.model === entry.spec.catalog);
  if (!cat) return { state: 'quebrado', errors: [{ path: 'catalog', message: `modelo "${entry.spec.catalog}" indisponível` }], pages: [] };
  const factColumns = (await factColumnsFor(project, cat.catalog.fact)) || [];
  const { pagesDir } = projectDirs(project);
  let files;
  try {
    files = compileReport(entry.spec, { catalog: cat.catalog, hash: cat.hash, factColumns });
  } catch (e) {
    return { state: 'quebrado', errors: [{ path: '', message: 'compilação falhou: ' + e.message }], pages: [] };
  }
  const rec = readBuildRecord(project)[entry.slug] || {};
  const pages = files.map((f) => {
    const p = path.join(pagesDir, f.path);
    if (!fs.existsSync(p)) return { path: f.path, exists: false, stale: false, diverged: false, specAhead: false };
    const disk = fs.readFileSync(p, 'utf8');
    if (disk === f.content) return { path: f.path, exists: true, stale: false, diverged: false, specAhead: false };
    const marks = findViewblocks(disk);
    const stale = marks.some((m) => m.meta?.catalogHash && m.meta.catalogHash !== cat.hash);
    // Divergência é INDEPENDENTE de stale (achado 3 da revisão): a edição
    // manual não pode ser mascarada por uma mudança de catálogo. Com baseline
    // do último build: divergente = a PÁGINA mudou desde ele. Sem baseline
    // (specs legadas): conservador — divergente até resolução explícita.
    const diverged = rec[f.path] !== undefined ? sha1(disk) !== rec[f.path] : true;
    const specAhead = !diverged; // página intocada desde o build; spec/catálogo à frente
    return { path: f.path, exists: true, stale, diverged, specAhead };
  });
  // divergente PRECEDE desatualizado: é o único estado que gate-ia o build.
  const state = pages.some((p) => p.diverged)
    ? 'divergente'
    : pages.some((p) => p.exists && p.stale)
      ? 'desatualizado'
      : pages.some((p) => !p.exists || p.specAhead)
        ? 'pendente'
        : 'ok';
  return { state, errors: [], pages, hash: cat.hash };
}

export function saveReport(project, slug, content) {
  const dir = reportsDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(slug).replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.writeFileSync(path.join(dir, safe + '.md'), content ?? '', 'utf8');
  const entry = getReport(project, safe);
  return { ok: true, slug: safe, errors: entry?.errors || [] };
}

/**
 * Build (D32): páginas divergentes NÃO cobertas por `force` bloqueiam — a
 * escolha (Recompilar × Reabsorver) é sempre explícita. O resto passa pela
 * MESMA esteira do apply (revalida, lint, políticas, sample, duas fases).
 */
export async function buildReport(project, slug, { force = [] } = {}) {
  const entry = getReport(project, slug);
  if (!entry) return { error: `relatório "${slug}" não encontrado` };
  if (!entry.valid) return { errors: entry.errors };
  const st = await reportStatus(project, entry);
  if (st.state === 'quebrado') return { errors: st.errors };
  const diverged = st.pages.filter((p) => p.diverged && !force.includes(p.path)).map((p) => p.path);
  if (diverged.length) return { diverged };
  const overwrite = st.pages.filter((p) => p.exists).map((p) => p.path);
  const r = await applyReport(project, entry.spec, overwrite);
  if (r.written) recordBuild(project, slug, r.written); // impressão digital do build
  return r;
}

// ---- Absorb / promote / sync (páginas → spec) -----------------------------

const stdLimit = (n) => (Number(n) === 1000 ? undefined : n);

/** Blocos de uma página a partir dos marcadores (o inverso do compilador). */
export function blocksFromPage(md, { dropParamFilterOf } = {}) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  for (const node of findViewblocks(md)) {
    const meta = node.meta;
    if (meta?.source?.kind !== 'semantic') continue;
    // título do bloco = heading '## ' imediatamente acima do marcador
    let title;
    for (let i = node.openLine - 1; i >= 0; i--) {
      const t = lines[i].trim();
      if (!t) continue;
      if (t.startsWith('## ')) title = t.slice(3).trim();
      break;
    }
    const filters = (meta.filters || []).filter((fl) => {
      const v = String((fl.values || [])[0] ?? '');
      if (dropParamFilterOf && v === '${params.' + dropParamFilterOf + '}') return false; // injetado pelo compilador
      return true;
    });
    out.push({
      id: String(meta.id || '').replace(/^vb_/, '') || undefined,
      ...(title ? { title } : {}),
      metrics: (meta.metrics || []).map((m) => m.name).filter(Boolean),
      dims: (meta.dims || []).map((d) => ({ dim: d.dim, ...(d.level ? { level: d.level } : {}) })).filter((d) => d.dim),
      filters,
      style: meta.style || 'tabular',
      ...(meta.roles && Object.keys(meta.roles).length ? { roles: meta.roles } : {}),
      ...(meta.pivot ? { pivot: meta.pivot } : {}),
      ...(meta.nested ? { nested: meta.nested } : {}),
      ...(stdLimit(meta.limit) !== undefined ? { limit: meta.limit } : {}),
    });
  }
  return out;
}

/** Prosa manual = linhas do disco que o build (com prose vazia) não emitiria. */
function proseFromPage(diskMd, generatedMd) {
  const stripVb = (md) => {
    const ls = String(md).split(/\r?\n/);
    const drop = new Set();
    for (const n of findViewblocks(md)) for (let i = n.openLine; i <= n.closeLine; i++) drop.add(i);
    return ls.filter((_, i) => !drop.has(i));
  };
  const gen = stripVb(generatedMd);
  const budget = new Map();
  for (const l of gen) budget.set(l, (budget.get(l) || 0) + 1);
  const extras = [];
  for (const l of stripVb(diskMd)) {
    const c = budget.get(l) || 0;
    if (c > 0) budget.set(l, c - 1);
    else extras.push(l);
  }
  return extras.join('\n').trim();
}

/**
 * Absorb (D32 "página vence"): reconstrói os BLOCKS da(s) página(s) no fence
 * da spec — patch cirúrgico, narrativa preservada. PROSA é heurística
 * (diferença de linhas, perde posição) e por isso é CONSENTIDA (achado 5):
 * só entra com {prose: true}; sem isso, devolvemos `proseDiff` para o usuário
 * ver e confirmar, e a página segue divergente (baseline não avança).
 */
export async function absorbReport(project, slug, { pages, prose = false } = {}) {
  const entry = getReport(project, slug);
  if (!entry) return { error: `relatório "${slug}" não encontrado` };
  const fence = extractSpecFence(entry.content);
  const doc = parseDocument(fence.yamlText);
  const spec = entry.spec || parseYaml(fence.yamlText);
  const cat = loadCatalogs(project).find((c) => c.valid && c.model === spec?.catalog);
  const { pagesDir } = projectDirs(project);
  const absorbed = [];
  const baseline = []; // páginas totalmente reconciliadas (spec == disco)
  const proseDiff = {};
  for (const [i, pg] of (spec?.pages || []).entries()) {
    const rel = outPathOf(pg);
    if (pages && !pages.includes(rel)) continue;
    const p = path.join(pagesDir, rel);
    if (!fs.existsSync(p)) continue;
    const disk = fs.readFileSync(p, 'utf8');
    const blocks = blocksFromPage(disk, { dropParamFilterOf: pg.parameter?.name });
    if (!blocks.length) continue;
    doc.setIn(['pages', i, 'blocks'], blocks);
    let extras = '';
    if (cat) {
      const provaSpec = JSON.parse(JSON.stringify(spec));
      provaSpec.pages[i] = { ...provaSpec.pages[i], blocks, prose: undefined };
      const factColumns = (await factColumnsFor(project, cat.catalog.fact)) || [];
      try {
        const gen = compileReport(provaSpec, { catalog: cat.catalog, hash: cat.hash, factColumns }).find((f) => f.path === rel);
        extras = gen ? proseFromPage(disk, gen.content) : '';
      } catch {
        /* compilação da prova falhou — blocks absorvidos mesmo assim */
      }
    }
    if (extras && !prose) {
      proseDiff[rel] = extras; // pede confirmação; página segue divergente
    } else {
      if (extras) doc.setIn(['pages', i, 'prose'], extras);
      else doc.deleteIn(['pages', i, 'prose']);
      baseline.push(rel);
    }
    absorbed.push(rel);
  }
  if (!absorbed.length) return { error: 'nenhuma página com blocos semânticos para absorver' };
  fs.writeFileSync(path.join(reportsDir(project), entry.file), embedFence(fence, doc), 'utf8');
  if (baseline.length) recordBuild(project, slug, baseline);
  const depois = getReport(project, slug);
  return { ok: true, absorbed, errors: depois?.errors || [], ...(Object.keys(proseDiff).length ? { proseDiff } : {}) };
}

/** Promove páginas existentes a relatório (spec nasce das páginas). */
export function promoteReport(project, { name, pages }) {
  const { pagesDir } = projectDirs(project);
  const slug = String(name || 'relatorio').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (getReport(project, slug)) return { error: `relatório "${slug}" já existe` };
  const specPages = [];
  let catalog = null;
  let globalParams = [];
  for (const rel of pages || []) {
    const p = path.join(pagesDir, String(rel).replace(/\\/g, '/'));
    if (!fs.existsSync(p)) return { error: `página não encontrada: ${rel}` };
    const disk = fs.readFileSync(p, 'utf8');
    const marks = findViewblocks(disk).filter((n) => n.meta?.source?.kind === 'semantic');
    if (!marks.length) return { error: `${rel} não tem blocos semânticos — só páginas de View Block semântico são promovíveis` };
    if (!catalog) catalog = marks[0].meta.source.name;
    if (!globalParams.length) globalParams = marks[0].meta.params || [];
    const mParam = String(rel).match(/\[([a-z_][a-z0-9_]*)\]\.md$/i);
    const paramName = mParam ? mParam[1] : null;
    // dimensão do parâmetro: revelada pelo filtro injetado '${params.x}'
    let paramDim = null;
    if (paramName) {
      for (const n of marks) {
        const f = (n.meta.filters || []).find((x) => String((x.values || [])[0] ?? '') === '${params.' + paramName + '}');
        if (f) {
          paramDim = f.dim;
          break;
        }
      }
    }
    const h1 = (disk.match(/^#\s+(.+)$/m) || [])[1] || rel;
    specPages.push({
      path: paramName ? `[${paramName}].md` : String(rel).replace(/\\/g, '/'),
      title: h1.replace(/\s*—\s*\{params\.[^}]+\}\s*$/, ''),
      ...(paramName ? { parameter: { name: paramName, dimension: paramDim || paramName } } : {}),
      blocks: blocksFromPage(disk, { dropParamFilterOf: paramName || undefined }),
    });
  }
  const spec = {
    name: slug,
    version: 1,
    title: name,
    purpose: 'Promovido de páginas existentes — revise a narrativa.',
    visibility: 'public',
    catalog,
    globalParams,
    pages: specPages,
    warnings: [],
  };
  const md = [
    `# ${name}`,
    '',
    'Relatório promovido de páginas existentes (F6). Edite a narrativa livremente —',
    'o contrato vive no bloco `studio-report` abaixo; o build recompila as páginas a partir dele.',
    '',
    '```studio-report',
    stringifyYaml(spec).replace(/\n$/, ''),
    '```',
    '',
  ].join('\n');
  const saved = saveReport(project, slug, md);
  // baseline = o disco de onde a spec nasceu (promover não é edição de página)
  if (saved.errors.length === 0) recordBuild(project, slug, specPages.map((pg) => outPathOf(pg)));
  return { ...saved, slug };
}

/**
 * Sync automático (D32/M37): depois que uma página POSSUÍDA é gravada pelo
 * editor/wizard, os BLOCOS dela voltam para a spec (prosa NÃO — vira
 * divergência detectável). O baseline só avança quando spec e disco ficam
 * IGUAIS (reedição canônica do wizard/drill) — edição manual de texto
 * permanece divergente e gate-ada. FALHAS AQUI LANÇAM (achado 1): o chamador
 * decide a transação (o PUT de página desfaz a gravação). O build não passa
 * por aqui (grava via applyReport) — sem loop.
 */
export async function syncPageToSpec(project, rel) {
  const clean = String(rel).replace(/\\/g, '/');
  const slug = pageOwner(project, clean);
  if (!slug) return null; // página solta — nada a sincronizar
  const entry = getReport(project, slug);
  const fence = extractSpecFence(entry.content);
  if (!fence) throw new Error(`spec "${slug}" sem fence de contrato`);
  const doc = parseDocument(fence.yamlText);
  const idx = (entry.spec.pages || []).findIndex((pg) => outPathOf(pg) === clean);
  if (idx < 0) return null;
  const { pagesDir } = projectDirs(project);
  const disk = fs.readFileSync(path.join(pagesDir, clean), 'utf8');
  const blocks = blocksFromPage(disk, { dropParamFilterOf: entry.spec.pages[idx].parameter?.name });
  if (!blocks.length) return null; // usuário removeu os blocos — divergência legítima
  doc.setIn(['pages', idx, 'blocks'], blocks);
  fs.writeFileSync(path.join(reportsDir(project), entry.file), embedFence(fence, doc), 'utf8');
  // baseline só quando totalmente reconciliadas (compile == disco)
  try {
    const depois = getReport(project, slug);
    const cat = loadCatalogs(project).find((c) => c.valid && c.model === depois.spec?.catalog);
    if (depois.valid && cat) {
      const factColumns = (await factColumnsFor(project, cat.catalog.fact)) || [];
      const gen = compileReport(depois.spec, { catalog: cat.catalog, hash: cat.hash, factColumns }).find((f) => f.path === clean);
      if (gen && gen.content === disk) recordBuild(project, slug, [clean]);
    }
  } catch {
    /* baseline é otimização — sem ela a página fica conservadoramente divergente */
  }
  return slug;
}
