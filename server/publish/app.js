// Publish ☁ (Universal SQL): Parquet + DuckDB-WASM no cliente. O pacote gerado
// (app.html + duckdb/ + data/*.parquet) roda as queries AO VIVO no navegador;
// atualização mensal = trocar o parquet (local ou em object storage com CORS).
// O render dos componentes é o MESMO do snapshot (StudioRuntime.createPublishRenderer).
import fs from 'node:fs';
import path from 'node:path';
import { getConnection, sqlPath, listSources } from '../db.js';
import { parseBlocks } from '../../shared/parser.js';
import { paramNameFromFile, collectInputNames } from '../../shared/templating.js';
import { resolveQueries, detectSources, listSchemaViews, itemsFromBlocks, collectParamPages } from './queries.js';
import { mountSourceUrls } from '../materialize.js';
import { getRuntimeBundle, readVendors, collectMaps, copyDuckdbRuntime, escapeHtml, publishCss } from './assets.js';

export async function buildPublishedApp(projectName, fileName, mdSource, settings, baseUrl, outDir, queriesDir, pagesDir) {
  const blocks = parseBlocks(mdSource);
  const queries = resolveQueries(blocks, queriesDir);

  // 1. Descobre fontes usadas e 2. exporta cada uma como Parquet.
  const allSources = (await listSources(projectName)).map((s) => s.name);
  const used = detectSources(queries, allSources);
  const dataDir = path.join(outDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const conn = await getConnection(projectName);
  const exported = [];
  // Fontes de MOUNT (Fase Fontes §2): ☁ lê DIRETO da URL — sem cópia; o
  // Airflow sobrescreve o objeto e o app reflete no reload, sem republicar.
  const mountUrls = mountSourceUrls(projectName);
  const sourceUrls = {};
  for (const name of used) {
    const mu = mountUrls[name];
    if (mu) {
      // remoto: URL como está; pasta local: servida pela rota mountfs do projeto
      sourceUrls[name] = mu.remote ? mu.url : `../../mountfs/${mu.mount}/${mu.file}`;
      exported.push(name);
      continue;
    }
    const target = path.join(dataDir, name + '.parquet');
    await conn.run(`COPY (SELECT * FROM "${name}") TO '${sqlPath(target)}' (FORMAT parquet)`);
    exported.push(name);
  }
  // Fontes qualificadas por schema (ex.: vendas.base — views de data/views/*.sql):
  // exporta o RESULTADO da view como parquet e recria schema+view no DuckDB-WASM.
  const schemaSources = [];
  for (const sv of await listSchemaViews(projectName)) {
    const re = new RegExp('\\b' + sv.schema + '\\s*\\.\\s*"?' + sv.table + '"?\\b', 'i');
    if (!queries.some((q) => re.test(q.sql))) continue;
    const file = sv.schema + '__' + sv.table;
    const target = path.join(dataDir, file + '.parquet');
    await conn.run(`COPY (SELECT * FROM "${sv.schema}"."${sv.table}") TO '${sqlPath(target)}' (FORMAT parquet)`);
    schemaSources.push({ schema: sv.schema, table: sv.table, file });
  }

  // 3. Runtime DuckDB-WASM (.wasm + workers + módulo bundlado).
  await copyDuckdbRuntime(outDir);

  // 4. Itens em ordem (recursivo) + queries cruas (placeholders resolvem no cliente).
  const items = itemsFromBlocks(blocks);
  const queryMap = {};
  for (const q of queries) queryMap[q.name] = q.sql; // mantém ${inputs..} e ${$page.params..} crus
  const inputNames = [...new Set(queries.flatMap((q) => collectInputNames(q.sql)))];
  const paramName = paramNameFromFile(fileName);

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
    paramPages: collectParamPages(pagesDir),
    maps: collectMaps(blocks),
    theme: settings?.theme || {},
    decimalSeparator: settings?.organization?.decimalSeparator || ',',
    generatedAt: new Date().toISOString(),
  };

  const vendors = readVendors();
  const runtime = await getRuntimeBundle();
  const html = renderAppHtml(payload, vendors.echarts, vendors.markdownit, runtime);
  fs.writeFileSync(path.join(outDir, 'app.html'), html, 'utf8');
  return { sources: [...exported, ...schemaSources.map((s) => s.schema + '.' + s.table)], dataBase: payload.dataBase, paramName };
}

function renderAppHtml(payload, echartsSrc, markdownitSrc, runtimeSrc) {
  const data = JSON.stringify(payload).replace(/<\//g, '<\\/');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
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
import * as duckdb from './duckdb/duckdb-browser.mjs';
const P = ${data};
const md = window.markdownit ? window.markdownit({html:false,linkify:true}) : { render:function(s){return s;} };
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
    mvp:{ mainModule:'./duckdb/duckdb-mvp.wasm', mainWorker:'./duckdb/duckdb-browser-mvp.worker.js' },
    eh:{ mainModule:'./duckdb/duckdb-eh.wasm', mainWorker:'./duckdb/duckdb-browser-eh.worker.js' }
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
  // Página parametrizada: lê ?<param>=valor da URL; default = 1º valor da query-convenção.
  if(P.paramName){
    var urlVal = new URLSearchParams(location.search).get(P.paramName);
    var values = [];
    var cq = P.queries[P.paramName];
    if(cq){ try{ var rows = await runSql(subst(cq)); values = rows.map(function(r){ return String(r[P.paramName] != null ? r[P.paramName] : Object.values(r)[0]); }); }catch(e){} }
    params[P.paramName] = (urlVal!=null && (values.length===0 || values.indexOf(urlVal)>=0)) ? urlVal : (values[0]||'');
    buildParamBar(values);
  }
  // Inicializa inputs com a 1ª opção de cada dropdown (opções estáticas — ex.
  // "Todos" — têm precedência sobre a 1ª linha da query de dados).
  function eachDropdown(items, cb){ (items||[]).forEach(function(it){ if(it.type==='dropdown') cb(it); if(it.children) eachDropdown(it.children, cb); }); }
  var dds=[]; eachDropdown(P.items, function(it){ dds.push(it); });
  for(const it of dds){
    if(it.staticOptions && it.staticOptions.length){ inputs[it.name]=it.staticOptions[0].value; continue; }
    try{ var opts = await runSql(subst(P.queries[it.dataQuery]||'')); if(opts.length) inputs[it.name]=opts[0][it.value]; }catch(e){}
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

function buildParamBar(values){
  var bar = document.getElementById('parambar');
  if(!P.paramName){ bar.innerHTML=''; return; }
  bar.className='pb';
  bar.innerHTML='';
  bar.appendChild(el('b',null,P.paramName+': '));
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
