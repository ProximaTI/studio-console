// Camada semântica (F3): carga e validação dos catálogos semantic/*.yaml do
// projeto. O YAML só existe AQUI — a API entrega o catálogo como JSON e o
// compilador (shared/semanticCompile.js) opera sobre o objeto.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse as parseYaml, parseDocument } from 'yaml';
import { PROJECTS_DIR, runQuery } from './db.js';
import { validateCatalog, internalDims } from '../shared/semanticCatalog.js';
import { findViewblocks } from '../shared/viewblock.js';

export function semanticDir(project) {
  const safe = String(project).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROJECTS_DIR, safe, 'semantic');
}

/** Hash curto do TEXTO do yaml — proveniência (spec §4): muda o catálogo, muda o hash. */
export function catalogHash(yamlText) {
  return crypto.createHash('sha1').update(String(yamlText)).digest('hex').slice(0, 8);
}

/** Carrega todos os modelos do projeto: [{file, model, label, valid, errors, catalog, hash}] */
export function loadCatalogs(project) {
  const dir = semanticDir(project);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    let catalog = null;
    let errors = [];
    try {
      catalog = parseYaml(text);
      errors = validateCatalog(catalog);
    } catch (e) {
      errors = [{ path: '', message: 'YAML inválido: ' + e.message }];
    }
    out.push({
      file: f,
      model: catalog?.model || f.replace(/\.ya?ml$/i, ''),
      label: catalog?.label || catalog?.model || f,
      valid: errors.length === 0,
      errors,
      catalog: errors.length === 0 ? catalog : null,
      hash: catalogHash(text),
    });
  }
  return out;
}

/** Um modelo específico (por nome do model), só se válido. */
export function getCatalog(project, model) {
  return loadCatalogs(project).find((m) => m.model === model && m.valid) || null;
}

/**
 * Colunas REAIS do fato (F4 frente F): habilita a validação profunda no save.
 * `null` quando a fonte não está registrada — a validação degrada para a
 * estrutural com aviso, nunca bloqueia o save.
 */
export async function factColumnsFor(project, fact) {
  if (!fact || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(fact))) return null;
  try {
    const r = await runQuery(`describe select * from "${fact}"`, project);
    return r.rows.map((row) => row.column_name);
  } catch {
    return null;
  }
}

// ---- Inferência de relações (F4 frente H) --------------------------------
// Sondas DETERMINÍSTICAS no DuckDB do projeto (SQL de template fixo — o LLM
// jamais escreve as sondas). Inferência é PROPOSTA com evidência: nada entra
// no YAML sem ratificação do arquiteto (apply-relations).

const NIVEL_NOME = { pais: 0, regiao: 1, estado: 2, uf: 2, municipio: 3, cidade: 3, ano: 0, trimestre: 1, mes: 2 };
const qi = (s) => '"' + String(s).replace(/"/g, '') + '"';

/**
 * Propostas: hierarquias dim→dim por dependência funcional (0 violações na
 * amostra) e cardinalidade dos joins declarados. Custo controlado: só dims de
 * coluna única com 2..limite valores distintos, pares ordenados por cardinalidade.
 */
export async function suggestRelations(project, model, limite = 10000) {
  const entry = loadCatalogs(project).find((m) => m.model === model && m.valid);
  if (!entry) throw new Error(`modelo "${model}" não encontrado ou inválido`);
  const cat = entry.catalog;
  const fact = qi(cat.fact);
  const totalLinhas = Number((await runQuery(`select count(*) n from ${fact}`, project)).rows[0].n);

  const singles = Object.entries(cat.dimensions || {})
    .filter(([, d]) => typeof d.column === 'string' && !d.column.includes('.') && !d.hierarchy)
    .map(([name, d]) => ({ name, column: d.column }));
  const card = {};
  for (const s of singles) {
    try {
      card[s.name] = Number((await runQuery(`select count(distinct ${qi(s.column)}) c from ${fact}`, project)).rows[0].c);
    } catch {
      card[s.name] = Infinity; // coluna quebrada não derruba a sondagem
    }
  }
  const eleg = singles.filter((s) => card[s.name] > 1 && card[s.name] <= limite);

  const jaDeclarado = new Set();
  for (const levels of Object.values(cat.hierarchies || {})) {
    if (!Array.isArray(levels)) continue;
    for (let i = 0; i < levels.length - 1; i++) jaDeclarado.add(levels[i] + '>' + levels[i + 1]);
  }

  const proposals = [];
  for (const filho of eleg) {
    for (const pai of eleg) {
      if (pai.name === filho.name || card[pai.name] >= card[filho.name]) continue; // pai = mais grosso
      if (jaDeclarado.has(pai.name + '>' + filho.name)) continue;
      // dependência funcional: cada valor do filho tem EXATAMENTE um pai
      const sql = `select count(*) v from (select ${qi(filho.column)} f, count(distinct ${qi(pai.column)}) c from ${fact} where ${qi(filho.column)} is not null group by 1) t where c > 1`;
      let viol;
      try {
        viol = Number((await runQuery(sql, project)).rows[0].v);
      } catch {
        continue;
      }
      if (viol !== 0) continue;
      const porNome =
        NIVEL_NOME[pai.name.toLowerCase()] !== undefined &&
        NIVEL_NOME[filho.name.toLowerCase()] !== undefined &&
        NIVEL_NOME[pai.name.toLowerCase()] < NIVEL_NOME[filho.name.toLowerCase()];
      proposals.push({
        kind: 'hierarchy',
        name: `${pai.name}_${filho.name}`,
        levels: [pai.name, filho.name],
        evidence:
          `${filho.name} → ${pai.name}: 0 violações em ${totalLinhas} linhas; ` +
          `${card[pai.name]} → ${card[filho.name]} valores distintos` +
          (porNome ? ' · corrobora a convenção de nomes' : ''),
      });
    }
  }

  // cardinalidade dos joins declarados: o lado "um" precisa ser único de fato
  for (const [i, j] of (cat.joins || []).entries()) {
    if (j.cardinality) continue;
    const [rt, rc] = String(j.right || '').split('.');
    if (!rt || !rc) continue;
    try {
      const r = await runQuery(`select count(*) n, count(distinct ${qi(rc)}) d from ${qi(rt)}`, project);
      const { n, d } = { n: Number(r.rows[0].n), d: Number(r.rows[0].d) };
      proposals.push({
        kind: 'cardinality',
        joinIndex: i,
        join: `${j.left} → ${j.right}`,
        cardinality: n === d ? 'many_to_one' : 'one_to_many',
        evidence: n === d ? `${rt}.${rc} é única (${d} de ${n} linhas) — 1 do lado da dimensão` : `${rt}.${rc} REPETE (${d} distintos em ${n} linhas) — risco de fan-out`,
      });
    } catch {
      /* tabela do join não registrada — sem evidência, sem proposta */
    }
  }

  return { model, file: entry.file, totalLinhas, proposals };
}

/**
 * Aplica propostas RATIFICADAS: edição cirúrgica do yaml via parseDocument
 * (preserva comentários/formatação — mesmo contrato do D18).
 */
export function applyRelations(project, model, { hierarchies = {}, cardinalities = [] } = {}) {
  const entry = loadCatalogs(project).find((m) => m.model === model);
  if (!entry) throw new Error(`modelo "${model}" não encontrado`);
  const file = path.join(semanticDir(project), entry.file);
  const doc = parseDocument(fs.readFileSync(file, 'utf8'));
  for (const [name, levels] of Object.entries(hierarchies)) {
    if (Array.isArray(levels) && levels.length >= 2) doc.setIn(['hierarchies', name], levels);
  }
  for (const c of cardinalities) {
    if (Number.isInteger(c.joinIndex) && ['many_to_one', 'one_to_one', 'one_to_many'].includes(c.cardinality))
      doc.setIn(['joins', c.joinIndex, 'cardinality'], c.cardinality);
  }
  fs.writeFileSync(file, String(doc), 'utf8');
  const novo = loadCatalogs(project).find((m) => m.model === model);
  return { ok: true, errors: novo?.errors || [], hash: novo?.hash };
}

/**
 * Políticas de publish (spec §6, D10): página com View Block semântico usando
 * dimensão `expose: internal` (ou pii sem política) NÃO compila no publish
 * público — ERRO, nunca omissão silenciosa. No publish interno, compila.
 */
export function checkPublishPolicies(project, mdSource, visibility = 'public') {
  if (visibility === 'internal') return { ok: true };
  const walk = (list, out = []) => {
    for (const n of list) {
      out.push(n);
      walk(n.children || [], out);
    }
    return out;
  };
  for (const node of walk(findViewblocks(mdSource))) {
    const meta = node.meta;
    if (meta?.source?.kind !== 'semantic') continue;
    const cat = getCatalog(project, meta.source.name);
    if (!cat) continue; // modelo removido/inválido — o bloco já falha por si
    const internas = internalDims(cat.catalog);
    const usadas = (meta.dims || []).map((d) => d.dim).filter((d) => internas.has(d));
    const emParams = (meta.params || []).map((p) => String(p.from).split('.')[0]).filter((d) => internas.has(d));
    const todas = [...new Set([...usadas, ...emParams])];
    if (todas.length) {
      return {
        ok: false,
        error:
          `Publish PÚBLICO recusado: o bloco ${meta.id} usa dimensão interna (${todas.join(', ')}) ` +
          `do modelo ${meta.source.name} (expose: internal / pii). Publique como INTERNO ou remova a dimensão.`,
      };
    }
  }
  return { ok: true };
}
