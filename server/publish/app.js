// Publish ☁ (Universal SQL): Parquet + DuckDB-WASM no cliente. O pacote gerado
// (app.html + duckdb/ + data/*.parquet) roda as queries AO VIVO no navegador;
// atualização mensal = trocar o parquet (local ou em object storage com CORS).
// O render dos componentes é o MESMO do snapshot (StudioRuntime.createPublishRenderer).
import fs from 'node:fs';
import path from 'node:path';
import { getConnection, sqlPath, listSources } from '../db.js';
import { parseBlocks } from '../../shared/parser.js';
import { paramNameFromFile, collectInputNames } from '../../shared/templating.js';
import { resolveQueries, detectSources, listSchemaViews, itemsFromBlocks, collectParamPages, listPages } from './queries.js';
import { pagePackages } from '../../shared/pageRoutes.js';
import { mountSourceUrls } from '../materialize.js';
import { getRuntimeBundle, readVendors, collectMaps, copyDuckdbRuntime, escapeHtml, publishCss, inlineBrandAssets } from './assets.js';
import { themeFor, readProjectConfig, validatePublish } from '../projectConfig.js';
import { findViewblocks } from '../../shared/viewblock.js';
import { dimExprOf } from '../../shared/semanticCompile.js';
import { escapeSqlValue } from '../../shared/templating.js';
import { loadCatalogs } from '../semantic.js';
import { sqlAst, analyzeAst, internalColumns, planSource, quoteIdent } from './prune.js';

/**
 * Predicado que recorta o FATO para um valor do parâmetro da página.
 *
 * Sem isso, o ☁ de uma página parametrizada exporta `SELECT *`: o app de uma
 * unidade/IES carrega o parquet de TODAS. Quem tem acesso legítimo a um recorte
 * baixa o arquivo inteiro que está ao lado do app.html — não é invasão, é o
 * artefato entregando o que ninguém pediu.
 *
 * O predicado é derivável do que já está no marcador: o filtro injetado pelo
 * compilador carrega {dim, level} (o level entrou junto com parameter.level), e
 * o catálogo converte isso na expressão sobre o fato — `"unidade"` para uma
 * dimensão simples, `year(cast("data" as date))` para um nível temporal.
 *
 * Devolve null quando não dá para derivar; o chamador então NÃO recorta e
 * declara isso no resultado, em vez de exportar tudo em silêncio.
 */
export function scopePredicate(projectName, mdSource, paramName, valor) {
  if (!paramName || valor === undefined || valor === null) return null;
  const alvo = '${params.' + paramName + '}';
  for (const node of findViewblocks(mdSource)) {
    const meta = node.meta || {};
    if (meta.source?.kind !== 'semantic' || !meta.source?.name) continue;
    const f = (meta.filters || []).find((x) => String((x.values || [])[0] ?? '') === alvo);
    if (!f) continue;
    const entrada = loadCatalogs(projectName).find((c) => c.valid && c.model === meta.source.name);
    if (!entrada) return null;
    try {
      const expr = dimExprOf(entrada.catalog, { dim: f.dim, ...(f.level ? { level: f.level } : {}) }, []);
      return { fato: entrada.catalog.fact, sql: `cast(${expr} as varchar) = '${escapeSqlValue(valor)}'`, dim: f.dim };
    } catch {
      return null;
    }
  }
  return null;
}

export async function buildPublishedApp(
  projectName,
  fileName,
  mdSource,
  settings,
  baseUrl,
  outDir,
  queriesDir,
  pagesDir,
  scopeValue,
  { visibility = 'public' } = {},
) {
  mdSource = inlineBrandAssets(mdSource); // /brand/x.svg -> data URI (ver assets.js)
  const blocks = parseBlocks(mdSource);
  const queries = resolveQueries(blocks, queriesDir);

  // 1. Descobre fontes usadas.
  const sourceList = await listSources(projectName);
  const allSources = sourceList.map((s) => s.name);
  const used = detectSources(queries, allSources);
  const conn = await getConnection(projectName);
  const paramFile = paramNameFromFile(fileName);
  const recorte = scopePredicate(projectName, mdSource, paramFile, scopeValue);
  // Fontes de MOUNT REMOTO (Fase Fontes §2): ☁ lê DIRETO da URL — sem cópia; o
  // Airflow sobrescreve o objeto e o app reflete no reload, sem republicar.
  // Mount de pasta local é exportado como fonte comum: antes era lido por
  // ../../mountfs/, rota da API — que não existe num servidor estático.
  const mountUrls = mountSourceUrls(projectName);
  const schemaViews = (await listSchemaViews(projectName)).filter((sv) => {
    const re = new RegExp('\\b' + sv.schema + '\\s*\\.\\s*"?' + sv.table + '"?\\b', 'i');
    return queries.some((q) => re.test(q.sql));
  });

  // 2. O que cada fonte LEVA (publish/prune.js): colunas citadas pelas queries,
  //    menos internas/pii (público) e exclusões; linhas pelo `where` declarado.
  //    Tudo planejado ANTES de gravar: um erro de política não deixa pacote pela metade.
  const analyses = [];
  for (const q of queries) {
    const ast = await sqlAst(conn, q.sql);
    analyses.push(ast ? { query: q.name, sql: q.sql, ...analyzeAst(ast, [...allSources, ...schemaViews.map((s) => s.table)]) } : { query: q.name, sql: q.sql, unparsed: true });
  }
  const cites = (a, re) => re.test(a.sql);
  const publishCfg = readProjectConfig(projectName).publish || {};
  const cfgErros = validatePublish(publishCfg);
  if (cfgErros.length) {
    const e = new Error('project.yaml: ' + cfgErros.map((x) => `${x.path}: ${x.message}`).join('; '));
    e.code = 'PUBLISH_POLICY';
    throw e;
  }
  const internas = internalColumns(loadCatalogs(projectName));
  const planos = [];
  for (const name of used) {
    if (mountUrls[name]?.remote) continue;
    const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    const columns = (sourceList.find((s) => s.name === name)?.columns || []).map((c) => c.name);
    const plano = planSource({
      name,
      columns,
      analyses: analyses.filter((a) => cites(a, re)),
      cfg: publishCfg[name] || {},
      internal: internas.get(name.toLowerCase()) || new Map(),
      visibility,
    });
    planos.push({ kind: 'source', name, file: name, from: `"${name}"`, plano });
  }
  for (const sv of schemaViews) {
    const re = new RegExp('\\b' + sv.schema + '\\s*\\.\\s*"?' + sv.table + '"?\\b', 'i');
    const d = await conn.runAndReadAll(`describe select * from "${sv.schema}"."${sv.table}"`);
    const columns = d.getRowObjects().map((r) => String(r.column_name));
    const key = sv.schema + '.' + sv.table;
    const plano = planSource({ name: sv.table, columns, analyses: analyses.filter((a) => cites(a, re)), cfg: publishCfg[key] || {}, visibility });
    planos.push({ kind: 'schema', name: key, sv, file: sv.schema + '__' + sv.table, from: `"${sv.schema}"."${sv.table}"`, plano });
  }
  const erros = planos.flatMap((p) => p.plano.errors);
  if (erros.length) {
    const e = new Error(erros.join('\n'));
    e.code = 'PUBLISH_POLICY';
    throw e;
  }

  // 3. Exporta cada fonte como Parquet, já podada e recortada.
  const dataDir = path.join(outDir, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true }); // parquet de publish anterior não fica para trás
  fs.mkdirSync(dataDir, { recursive: true });
  const exported = [];
  const escopo = [];
  const avisos = [];
  const sourceUrls = {};
  for (const name of used) {
    const mu = mountUrls[name];
    if (!mu?.remote) continue;
    sourceUrls[name] = mu.url;
    exported.push(name);
    escopo.push({ source: name, recortado: false, motivo: 'mount remoto — o arquivo é servido de fora do pacote, sem poda de colunas' });
    avisos.push(`${name}: mount remoto — o pacote aponta para o arquivo inteiro em ${new URL(mu.url).origin}`);
  }
  const schemaSources = [];
  for (const p of planos) {
    const { plano } = p;
    // Só o FATO é recortável pelo parâmetro da página; o `where` declarado vale para qualquer fonte.
    const conds = [plano.where ? `(${plano.where})` : '', recorte && recorte.fato === p.name ? `(${recorte.sql})` : ''].filter(Boolean);
    const where = conds.length ? ` where ${conds.join(' and ')}` : '';
    const target = path.join(dataDir, p.file + '.parquet');
    await conn.run(`COPY (SELECT ${plano.select.map(quoteIdent).join(', ')} FROM ${p.from}${where}) TO '${sqlPath(target)}' (FORMAT parquet)`);
    const n = await conn.runAndReadAll(`select count(*) from read_parquet('${sqlPath(target)}')`);
    if (p.kind === 'schema') schemaSources.push({ schema: p.sv.schema, table: p.sv.table, file: p.file });
    else exported.push(p.name);
    avisos.push(...plano.warnings);
    escopo.push({
      source: p.name,
      recortado: !!(recorte && recorte.fato === p.name),
      where: plano.where || null,
      linhas: Number(n.getRows()[0][0]),
      colunas: plano.kept,
      removidas: plano.dropped,
    });
  }

  // 3. Runtime DuckDB-WASM: UMA cópia por projeto, ao lado dos apps — ver
  //    copyDuckdbRuntime. `duckBase` é como o app.html o alcança.
  await copyDuckdbRuntime(path.join(path.dirname(outDir), 'duckdb'));
  const duckBase = '../duckdb';

  // 4. Itens em ordem (recursivo) + queries cruas (placeholders resolvem no cliente).
  const items = itemsFromBlocks(blocks);
  const queryMap = {};
  for (const q of queries) queryMap[q.name] = q.sql; // mantém ${inputs..} e ${$page.params..} crus
  const inputNames = [...new Set(queries.flatMap((q) => collectInputNames(q.sql)))];
  const paramName = paramFile;

  const payload = {
    title: fileName.replace(/\.md$/, ''),
    project: projectName,
    items,
    queries: queryMap,
    sources: exported,
    sourceUrls,
    schemaSources,
    dataBase: baseUrl && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, '') : './data',
    remote: !!(baseUrl && baseUrl.trim()),
    inputNames,
    paramName,
    // Recorte por valor: o app já nasce no valor, sem seletor para trocar —
    // trocar não faria sentido, os dados dos outros não estão no pacote.
    fixedParam: scopeValue !== undefined && scopeValue !== null ? { name: paramName, value: String(scopeValue) } : null,
    paramPages: collectParamPages(pagesDir),
    // Rota → pacote (shared/pageRoutes.js): links internos chegam ao pacote
    // com o MESMO nome que o publish deu a cada página.
    pagePackages: pagePackages(listPages(pagesDir)),
    maps: collectMaps(blocks),
    // Tema EFETIVO do projeto (project.yaml → settings global → default).
    theme: themeFor(projectName),
    decimalSeparator: settings?.organization?.decimalSeparator || ',',
    generatedAt: new Date().toISOString(),
  };

  const vendors = readVendors();
  const runtime = await getRuntimeBundle();
  const html = renderAppHtml(payload, vendors.echarts, vendors.markdownit, runtime, duckBase);
  fs.writeFileSync(path.join(outDir, 'app.html'), html, 'utf8');
  return {
    sources: [...exported, ...schemaSources.map((s) => s.schema + '.' + s.table)],
    dataBase: payload.dataBase,
    paramName,
    // O que o PACOTE contém, não o que a tela mostra. `recortado: false` numa
    // página parametrizada significa que o artefato leva todos os valores.
    escopo,
    avisos,
    scopeValue: scopeValue ?? null,
    scopeDim: recorte ? recorte.dim : null,
  };
}

/**
 * Origens que o app precisa alcançar além da própria: baseUrl remoto (object
 * storage) e mounts remotos. Vira a connect-src da CSP em <meta> do app.html —
 * o servidor manda uma CSP larga (https:) e esta a estreita para o pacote.
 */
export function appConnectOrigins(payload) {
  const urls = [payload.remote ? payload.dataBase : null, ...Object.values(payload.sourceUrls || {})];
  const out = new Set();
  for (const u of urls) {
    try {
      const o = new URL(String(u)).origin;
      if (o && o !== 'null') out.add(o);
    } catch {
      /* relativo: coberto por 'self' */
    }
  }
  return [...out].sort();
}

// `duckBase`: caminho do runtime DuckDB-WASM visto pelo app.html. Ele é
// compartilhado entre os apps do projeto, então nunca é './duckdb'.
function renderAppHtml(payload, echartsSrc, markdownitSrc, runtimeSrc, duckBase) {
  const data = JSON.stringify(payload).replace(/<\//g, '<\\/');
  const connect = ["'self'", 'blob:', ...appConnectOrigins(payload)].join(' ');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="connect-src ${escapeHtml(connect)}; object-src 'none'; base-uri 'none'"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(payload.title)} — Studio Console</title>
<style>${publishCss(payload.theme)}</style>
</head>
<body>
<div class="wrap">
  <div class="pub-banner">
    <span>🦆 App com Universal SQL — dados via DuckDB-WASM (${payload.remote ? 'object storage remoto' : 'pasta ./data local'})</span>
    <span>publicado em ${new Date(payload.generatedAt).toLocaleString('pt-BR')}</span>
  </div>
  <div id="status">Carregando DuckDB-WASM…</div>
  <div id="parambar"></div>
  <div id="app" style="display:none"></div>
</div>
<script>${echartsSrc}</script>
<script>${markdownitSrc}</script>
<script>${runtimeSrc}</script>
<script type="module">
import * as duckdb from '${duckBase}/duckdb-browser.mjs';
const P = ${data};
const md = window.markdownit ? window.markdownit({html:false,linkify:true}) : { render:function(s){return s;} };
StudioRuntime.allowInlineSvg(md); // aceita ![x](data:image/svg+xml;base64,…) — ver shared/markdownPolicy.js
const inputs = {};
const params = {};
const dataMap = {};
let conn = null;

function el(tag, cls, html){ var e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
// Placeholders SQL via StudioRuntime (mesmo código do editor).
function subst(sql){ return StudioRuntime.applyTemplates(sql, inputs, params); }

const R = StudioRuntime.createPublishRenderer({
  echarts: window.echarts,
  md: md,
  theme: P.theme,
  decimalSeparator: P.decimalSeparator,
  maps: P.maps,
  paramPages: P.paramPages,
  pagePackages: P.pagePackages,
  hrefMode: 'app',
  dataFor: function(name){ return (name && dataMap[name]) || []; },
  renderInline: function(t){ return StudioRuntime.renderInline(t, dataMap, params, inputs); },
  getInput: function(n){ return inputs[n]; },
  setInput: async function(n, v){ inputs[n] = v; await runAll(); render(); },
});
function render(){ R.render(document.getElementById('app'), P.items); }

function normRow(row, dateCols){
  var o={};
  for(var k in row){
    var v=row[k];
    if(typeof v==='bigint'){ v=(v>=-9007199254740991n&&v<=9007199254740991n)?Number(v):v.toString(); }
    if(dateCols[k] && v!=null){ try{ v = new Date(Number(v)).toISOString().slice(0,10); }catch(e){} }
    o[k]=v;
  }
  return o;
}
async function runSql(sql){
  var res = await conn.query(sql);
  // Detecta colunas DATE/TIMESTAMP pelo schema (Arrow typeId: Date=8, Timestamp=10).
  var dateCols={};
  try{ (res.schema.fields||[]).forEach(function(f){ var t=f.type&&f.type.typeId; if(t===8||t===10) dateCols[f.name]=true; }); }catch(e){}
  return res.toArray().map(function(r){ return normRow(r.toJSON(), dateCols); });
}
async function runAll(){
  for(var name in P.queries){
    try{ dataMap[name] = await runSql(subst(P.queries[name])); }
    catch(e){ dataMap[name] = {__error: String(e.message||e)}; }
  }
}

async function init(){
  const BUNDLES = {
    mvp:{ mainModule:'${duckBase}/duckdb-mvp.wasm', mainWorker:'${duckBase}/duckdb-browser-mvp.worker.js' },
    eh:{ mainModule:'${duckBase}/duckdb-eh.wasm', mainWorker:'${duckBase}/duckdb-browser-eh.worker.js' }
  };
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(new URL(bundle.mainWorker, location.href));
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(new URL(bundle.mainModule, location.href).href);
  conn = await db.connect();
  // Registra cada fonte (parquet) como view, resolvendo a URL relativa/remota.
  for(const s of P.sources){
    const url = new URL((P.sourceUrls && P.sourceUrls[s]) || (P.dataBase + '/' + s + '.parquet'), location.href).href;
    await db.registerFileURL(s + '.parquet', url, duckdb.DuckDBDataProtocol.HTTP, false);
    await conn.query('CREATE OR REPLACE VIEW "' + s + '" AS SELECT * FROM read_parquet(\\'' + s + '.parquet\\')');
  }
  // Fontes com schema (ex.: vendas.base): recria schema + view sobre o parquet.
  for(const sv of (P.schemaSources||[])){
    const url = new URL(P.dataBase + '/' + sv.file + '.parquet', location.href).href;
    await db.registerFileURL(sv.file + '.parquet', url, duckdb.DuckDBDataProtocol.HTTP, false);
    await conn.query('CREATE SCHEMA IF NOT EXISTS "' + sv.schema + '"');
    await conn.query('CREATE OR REPLACE VIEW "' + sv.schema + '"."' + sv.table + '" AS SELECT * FROM read_parquet(\\'' + sv.file + '.parquet\\')');
  }
  // Pacote RECORTADO: o valor já é o do pacote e não há o que trocar — os dados
  // dos outros valores não estão aqui. Fixa e mostra como rótulo, sem seletor.
  if(P.fixedParam){
    params[P.fixedParam.name] = P.fixedParam.value;
    var bar0 = document.getElementById('parambar');
    bar0.className='pb';
    bar0.innerHTML='';
    bar0.appendChild(el('b',null,P.fixedParam.name+': '));
    bar0.appendChild(el('span',null,P.fixedParam.value));
  }
  // Página parametrizada: lê ?<param>=valor da URL; default = 1º valor da query-convenção.
  else if(P.paramName){
    var urlVal = new URLSearchParams(location.search).get(P.paramName);
    var values = await paramValues();
    params[P.paramName] = (urlVal!=null && (values.length===0 || values.indexOf(urlVal)>=0)) ? urlVal : (values[0]||'');
    buildParamBar(values);
    // Sem valor na URL e sem lista de onde tirar um: rodar as queries com ''
    // dava ⟨?⟩ e erro de conversão. Diz o que falta em vez disso.
    if(!params[P.paramName]){
      document.getElementById('status').innerHTML = '<div class="err">Esta página mostra um(a) <b>' + P.paramName + '</b> por vez — abra-a a partir de um link que traga <code>?' + P.paramName + '=…</code>.</div>';
      return;
    }
  }
  // Valor inicial de cada dropdown pela MESMA regra do editor
  // (StudioRuntime.initialDropdownValue): opções estáticas (ex. "Todos") antes
  // das da query; defaultValue quando é uma das opções; multiple SEMPRE array —
  // escalar virava \`in (I2049…)\` sem aspas no IN (\${inputs.x}).
  function eachDropdown(items, cb){ (items||[]).forEach(function(it){ if(it.type==='dropdown') cb(it); if(it.children) eachDropdown(it.children, cb); }); }
  var dds=[]; eachDropdown(P.items, function(it){ dds.push(it); });
  for(const it of dds){
    var opts = (it.staticOptions||[]).slice();
    if(it.dataQuery && P.queries[it.dataQuery]){
      try{ (await runSql(subst(P.queries[it.dataQuery]))).forEach(function(r){ opts.push({ value: r[it.value], label: r[it.label] }); }); }catch(e){}
    }
    var v0 = StudioRuntime.initialDropdownValue(it, opts);
    if(v0 !== undefined) inputs[it.name] = v0;
  }
  // Inputs livres (TextInput/Slider/DateRange): semeia os defaults antes do 1º run.
  function eachComp(items, cb){ (items||[]).forEach(function(it){ if(it.type==='component'){ cb(it); if(it.children) eachComp(it.children, cb); } }); }
  eachComp(P.items, function(it){
    var a = it.attrs || {};
    if(a.name == null || inputs[a.name] !== undefined) return;
    if(it.name==='TextInput') inputs[a.name] = a.defaultValue != null ? a.defaultValue : '';
    if(it.name==='Slider') inputs[a.name] = Number(a.defaultValue != null ? a.defaultValue : (a.min != null ? a.min : 0));
    if(it.name==='DateRange') inputs[a.name] = { start: a.start || '1900-01-01', end: a.end || '2100-12-31' };
  });
  await runAll();
  document.getElementById('status').style.display='none';
  document.getElementById('app').style.display='';
  render();
}

// Valores possíveis do parâmetro da página, pela MESMA convenção do editor
// (ProjectEditor): a query com o nome do parâmetro, se houver; senão a 1ª query
// da página que não depende do próprio parâmetro e tem uma coluna com esse nome.
async function paramValues(){
  var p = P.paramName;
  var nomes = [p].concat(Object.keys(P.queries).filter(function(n){ return n !== p; }));
  for(const n of nomes){
    var q = P.queries[n];
    if(!q || /\\$\\{\\s*(\\$page\\.)?params\\./.test(q)) continue;
    try{
      var rows = await runSql('select distinct "' + p + '" as v from (' + subst(q).replace(/;\\s*$/, '') + ') t where "' + p + '" is not null order by 1');
      if(rows.length) return rows.map(function(r){ return String(r.v); });
    }catch(e){}
  }
  return [];
}

function buildParamBar(values){
  var bar = document.getElementById('parambar');
  if(!P.paramName){ bar.innerHTML=''; return; }
  bar.className='pb';
  bar.innerHTML='';
  bar.appendChild(el('b',null,P.paramName+': '));
  // Sem lista de valores (a página só sabe o que veio na URL): rótulo, não um seletor vazio.
  if(!values.length){ bar.appendChild(el('span',null,null)).textContent = params[P.paramName] || ''; return; }
  var sel=document.createElement('select');
  values.forEach(function(v){ var op=document.createElement('option'); op.value=v; op.textContent=v; sel.appendChild(op); });
  sel.value = params[P.paramName];
  sel.onchange = async function(){
    params[P.paramName]=sel.value;
    var u=new URL(location.href); u.searchParams.set(P.paramName, sel.value); history.replaceState(null,'',u);
    await runAll(); render();
  };
  bar.appendChild(sel);
}

init().catch(function(e){
  document.getElementById('status').innerHTML = '<div class="err">Falha ao iniciar: ' + String(e.message||e) + '</div>';
});
</script>
</body>
</html>`;
}
