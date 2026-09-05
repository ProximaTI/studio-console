// Publish 📦 (snapshot): HTML ÚNICO offline. Pré-computa o resultado de todas as
// queries para cada combinação de valores dos Dropdowns e embute tudo no HTML.
// Trocar um filtro no navegador apenas seleciona outro snapshot — sem servidor.
// O render dos componentes é o MESMO do app dinâmico (StudioRuntime.createPublishRenderer).
import { runQuery } from '../db.js';
import { parseBlocks } from '../../shared/parser.js';
import { applyTemplates, collectInputNames } from '../../shared/templating.js';
import { resolveQueries, itemsFromBlocks, walkDropdowns, cartesian, comboKey } from './queries.js';
import { getRuntimeBundle, readVendors, collectMaps, escapeHtml, publishCss } from './assets.js';
import { sourceFreshness } from '../materialize.js';

export async function buildPublishedHtml(projectName, fileName, mdSource, settings, queriesDir) {
  const blocks = parseBlocks(mdSource);
  const queries = resolveQueries(blocks, queriesDir);
  const items = itemsFromBlocks(blocks);

  // Dropdowns em qualquer nível (inclusive dentro de Grid/div/Details).
  const dropdowns = [];
  walkDropdowns(items, (d) => dropdowns.push(d));

  // Opções de cada dropdown: estáticas (<DropdownOption/>, ex. "Todos") vêm
  // PRIMEIRO e definem o default; depois as linhas da query de dados.
  const inputDefs = []; // { name, options:[{value,label}] }
  for (const d of dropdowns) {
    const options = (d.staticOptions || []).map((o) => ({ value: String(o.value), label: String(o.label) }));
    const q = queries.find((x) => x.name === d.dataQuery);
    if (q) {
      try {
        const r = await runQuery(q.sql, projectName); // queries de opções não dependem de inputs
        for (const row of r.rows || []) options.push({ value: String(row[d.value]), label: String(row[d.label]) });
      } catch {
        /* dropdown fica só com as estáticas */
      }
    }
    inputDefs.push({ name: d.name, options });
  }
  const inputNames = inputDefs.map((d) => d.name);

  // Inputs LIVRES (TextInput/Slider/DateRange): o snapshot não pré-computa
  // combinações para eles — congela no valor default (o ☁ app é o interativo).
  const freeDefaults = {};
  const walkFree = (list) => {
    for (const it of list || []) {
      if (it.type !== 'component') continue;
      const a = it.attrs || {};
      if (a.name != null) {
        if (it.name === 'TextInput') freeDefaults[a.name] = a.defaultValue ?? '';
        if (it.name === 'Slider') freeDefaults[a.name] = Number(a.defaultValue ?? a.min ?? 0);
        if (it.name === 'DateRange') freeDefaults[a.name] = { start: a.start || '1900-01-01', end: a.end || '2100-12-31' };
      }
      if (it.children) walkFree(it.children);
    }
  };
  walkFree(items);
  const freeNames = Object.keys(freeDefaults);

  // Queries estáticas (sem inputs de combinação) rodam uma vez com os defaults
  // dos inputs livres; dinâmicas rodam por combinação de Dropdowns.
  const staticData = {};
  const dynamicQueries = [];
  for (const q of queries) {
    const comboInputs = collectInputNames(q.sql).filter((n) => !freeNames.includes(n));
    if (comboInputs.length === 0) {
      try {
        const r = await runQuery(applyTemplates(q.sql, freeDefaults, {}), projectName);
        staticData[q.name] = r.error ? [] : r.rows || [];
      } catch {
        staticData[q.name] = [];
      }
    } else {
      dynamicQueries.push(q);
    }
  }

  // Combinações dos inputs (produto cartesiano, com teto de segurança).
  const valueLists = inputDefs.map((d) => (d.options.length ? d.options.map((o) => o.value) : ['']));
  let combos = cartesian(valueLists);
  const CAP = 500;
  let truncated = false;
  if (combos.length > CAP) {
    combos = combos.slice(0, CAP);
    truncated = true;
  }

  const dynamicData = {}; // comboKey -> { queryName: rows }
  const defaults = {};
  inputDefs.forEach((d) => (defaults[d.name] = d.options[0]?.value ?? ''));

  for (const combo of combos) {
    const inputs = {};
    inputDefs.forEach((d, i) => (inputs[d.name] = combo[i]));
    const key = comboKey(inputNames, inputs);
    dynamicData[key] = {};
    for (const q of dynamicQueries) {
      try {
        const r = await runQuery(applyTemplates(q.sql, { ...freeDefaults, ...inputs }, {}), projectName);
        dynamicData[key][q.name] = r.error ? [] : r.rows || [];
      } catch {
        dynamicData[key][q.name] = [];
      }
    }
  }

  const payload = {
    title: fileName.replace(/\.md$/, ''),
    project: projectName,
    items,
    staticData,
    dynamicData,
    inputNames,
    defaults,
    freeDefaults,
    queryNames: queries.map((q) => q.name),
    maps: collectMaps(blocks),
    theme: settings?.theme || {},
    decimalSeparator: settings?.organization?.decimalSeparator || ',',
    generatedAt: new Date().toISOString(),
    // Transparência de frescor (Fase Fontes §5): "dados de quando" no artefato.
    dataAsOf: (() => {
      try {
        const ts = Object.values(sourceFreshness(projectName)).map((f) => f.materializedAt).filter(Boolean).sort();
        return ts[ts.length - 1] || null;
      } catch {
        return null;
      }
    })(),
    truncated,
  };

  const vendors = readVendors();
  const runtime = await getRuntimeBundle();
  return renderHtml(payload, vendors.echarts, vendors.markdownit, runtime);
}

function renderHtml(payload, echartsSrc, markdownitSrc, runtimeSrc) {
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
    <span>📦 Snapshot offline — dados embutidos no HTML${payload.truncated ? ' · ⚠ combinações de filtro truncadas em 500' : ''}</span>
    <span>publicado em ${new Date(payload.generatedAt).toLocaleString('pt-BR')}${payload.dataAsOf ? ' · dados materializados em ' + new Date(payload.dataAsOf).toLocaleString('pt-BR') : ''}</span>
  </div>
  <div id="app"></div>
</div>
<script>${echartsSrc}</script>
<script>${markdownitSrc}</script>
<script>${runtimeSrc}</script>
<script>
const P = ${data};
const md = window.markdownit ? window.markdownit({html:false,linkify:true}) : { render:function(s){return s;} };
const inputs = Object.assign({}, P.freeDefaults || {}, P.defaults);

function comboKey(){ return P.inputNames.map(function(n){ return n+'='+(inputs[n]!=null?inputs[n]:''); }).join('&'); }
function dataFor(name){
  if(!name) return [];
  if(P.staticData[name]) return P.staticData[name];
  var d = P.dynamicData[comboKey()];
  return (d && d[name]) || [];
}
function scope(){
  var m = {};
  P.queryNames.forEach(function(n){ m[n] = dataFor(n); });
  return m;
}

const R = StudioRuntime.createPublishRenderer({
  echarts: window.echarts,
  md: md,
  theme: P.theme,
  decimalSeparator: P.decimalSeparator,
  maps: P.maps,
  paramPages: {},
  hrefMode: 'snapshot',
  staticInputs: true,
  dataFor: dataFor,
  renderInline: function(t){ return StudioRuntime.renderInline(t, scope(), {}, inputs); },
  getInput: function(n){ return inputs[n]; },
  setInput: function(n, v){ inputs[n] = v; render(); },
});

function render(){ R.render(document.getElementById('app'), P.items); }
render();
</script>
</body>
</html>`;
}
