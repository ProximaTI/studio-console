// Registro de ESTILOS do View Block (spec §5 Passo 4) + compilador.
// Cada estilo declara contrato (requires) e compilação (compile) — a galeria
// do wizard habilita/desabilita pelo contrato e "trocar o estilo recompila só
// o bloco". Vive em shared/ porque o fluxo do agente (server) e o wizard (web)
// caem no MESMO compilador: SQL nunca vem da IA.
//
// Convenções (casadas com web/src/builder/sqlgen.ts):
//   alias de métrica  = `${agg}_${column}`   (count_distinct_doi)
//   alias de dimensão = column
// Forma canônica de emissão: segmentos separados por LINHA EM BRANCO
// (contrato do notebook M4 — round-trip byte a byte das células).
import { serializeVbMeta } from './viewblock.js';
import { escapeSqlValue } from './templating.js';

const q = (id) => '"' + String(id).replace(/"/g, '') + '"';
const attrEsc = (s) => String(s).replace(/"/g, '&quot;');

// Fonte semântica traz alias pronto (= nome da métrica/nível do catálogo);
// o shape F2 (agg+column) continua como fallback.
export const metricAlias = (m) => m.alias || m.agg + '_' + m.column;
export const dimAlias = (d) => d.alias || d.column;

const TEMPORAL_NAME = /(^|_)(ano|year|data|date|mes|month|dia|day|trimestre|quarter)$/i;
const TEMPORAL_TYPE = /DATE|TIMESTAMP/i;

/** Dimensão com cara de tempo (por nome, ou por tipo na fonte). */
export function isTemporalDim(dim, source) {
  if (TEMPORAL_NAME.test(dim.column)) return true;
  const col = (source?.columns || []).find((c) => c.name === dim.column);
  return !!col && TEMPORAL_TYPE.test(String(col.type));
}

const need = (ok, reason) => (ok ? { ok: true } : { ok: false, reason });

/**
 * Predicado SQL de um argumento declarado, por tipo (Passo 3 — o tipo determina
 * o input E o predicado). Sintaxe canônica Evidence por componente:
 *   enum → Dropdown  ${inputs.x.value} · text → TextInput  ${inputs.x}
 *   number → Slider  ${inputs.x} (limiar mínimo) · date → DateRange  .start/.end
 */
export function paramPredicate(p, colExpr) {
  const t = p.type || 'enum';
  if (t === 'enum') return 'cast(' + colExpr + " as varchar) like '${inputs." + p.name + ".value}'";
  if (t === 'text') return 'cast(' + colExpr + " as varchar) like '${inputs." + p.name + "}'";
  if (t === 'number') return 'cast(' + colExpr + ' as double) >= ${inputs.' + p.name + '}';
  if (t === 'date') return 'cast(' + colExpr + " as date) between '${inputs." + p.name + ".start}' and '${inputs." + p.name + ".end}'";
  throw new Error('Tipo de argumento desconhecido: ' + t);
}

// Predicados dos argumentos declarados para estilos que montam o PRÓPRIO SQL
// (papéis/pivot) — coluna direta, sem alias de tabela.
function paramPreds(vb) {
  return (vb.params || []).map((p) => paramPredicate(p, q(p.from)));
}
const whereOf = (vb) => {
  const preds = paramPreds(vb);
  return preds.length ? '\nwhere ' + preds.join('\n  and ') : '';
};

/** Papéis obrigatórios mapeados e existentes na fonte? (needsRoles guia a UI) */
function checkRoles(vb, source, required, optional = []) {
  const r = vb.roles || {};
  const missing = required.filter((k) => !r[k]);
  if (missing.length) return { ok: false, needsRoles: true, reason: 'mapeie os papéis: ' + missing.join(', ') };
  const cols = new Set((source?.columns || []).map((c) => c.name));
  const bad = [...required, ...optional].filter((k) => r[k] && !cols.has(r[k]));
  if (bad.length) return { ok: false, needsRoles: true, reason: 'colunas inexistentes na fonte: ' + bad.map((k) => r[k]).join(', ') };
  return { ok: true };
}

// body helpers -------------------------------------------------------------

function dataTableBody(vb, qname) {
  const hasMeta = (vb.metrics || []).some((m) => m.label || m.fmt);
  if (!hasMeta) return `<DataTable data={${qname}}/>`;
  const cols = [
    ...(vb.dims || []).map((d) => `  <Column id=${dimAlias(d)}/>`),
    ...(vb.metrics || []).map(
      (m) => `  <Column id=${metricAlias(m)}${m.label ? ` title="${attrEsc(m.label)}"` : ''}${m.fmt ? ` fmt=${m.fmt}` : ''}/>`
    ),
  ];
  return `<DataTable data={${qname}}>\n${cols.join('\n')}\n</DataTable>`;
}

function chartBody(tag, vb, qname) {
  const x = dimAlias(vb.dims[0]);
  const ys = (vb.metrics || []).map(metricAlias);
  const y = ys.length === 1 ? ys[0] : `{${JSON.stringify(ys)}}`;
  return `<${tag} data={${qname}} x=${x} y=${y}/>`;
}

// registro ------------------------------------------------------------------

export const STYLES = [
  {
    id: 'tabular',
    label: 'Tabular',
    queryCount: 1,
    requires: (vb) => need((vb.dims || []).length >= 1 && (vb.metrics || []).length >= 1, 'precisa de ≥1 dimensão e ≥1 métrica'),
    compile: (ctx) => oneQuery(ctx, (vb, qn) => dataTableBody(vb, qn)),
  },
  {
    id: 'graph.bar',
    label: 'Graph · barras',
    queryCount: 1,
    requires: (vb) => need((vb.dims || []).length === 1 && (vb.metrics || []).length >= 1, 'precisa de exatamente 1 dimensão e ≥1 métrica'),
    compile: (ctx) => oneQuery(ctx, (vb, qn) => chartBody('BarChart', vb, qn)),
  },
  {
    id: 'graph.line',
    label: 'Graph · linha (tempo)',
    queryCount: 1,
    requires: (vb, source) =>
      need(
        (vb.dims || []).length === 1 && (vb.metrics || []).length >= 1 && isTemporalDim(vb.dims[0], source),
        'precisa de 1 dimensão TEMPORAL (ano/data/mês) e ≥1 métrica'
      ),
    // O SQL da fonte ordena por MÉTRICA desc (top-N). Num eixo de tempo isso
    // embaralha a série: o eixo X é categórico e segue a ordem das linhas.
    // Reordena CRONOLOGICAMENTE por fora — o recorte (filtros/limit) fica
    // intacto na subquery, só a apresentação muda.
    compile: (ctx) => {
      const vb = ctx.vb;
      const name = vb.queries?.[0]?.name || vb.id;
      const base = String(ctx.baseSql).trim();
      const indent = base.split('\n').map((l) => '  ' + l).join('\n');
      const sql = `select * from (\n${indent}\n) t\norder by ${q(dimAlias(vb.dims[0]))}`;
      return { queries: [{ name, sql }], body: chartBody('LineChart', vb, name) };
    },
  },
  {
    // Dispersão/bolhas: o plano cartesiano de DUAS métricas — a forma de
    // leitura de painéis de posicionamento (especialização × participação,
    // risco × retorno). Convenção da seleção, sem papéis:
    //   métrica 1 = eixo X · métrica 2 = eixo Y · métrica 3 (opcional) = tamanho
    //   dimensão 1 = rótulo do ponto · dimensão 2 (opcional) = série (cor)
    id: 'graph.bubble',
    label: 'Graph · bolhas (dispersão)',
    queryCount: 1,
    requires: (vb) =>
      need(
        (vb.dims || []).length >= 1 && (vb.metrics || []).length >= 2,
        'precisa de ≥1 dimensão (rótulo) e ≥2 métricas (X e Y; a 3ª vira o tamanho da bolha)'
      ),
    compile: (ctx) =>
      oneQuery(ctx, (vb, qn) => {
        const ms = (vb.metrics || []).map(metricAlias);
        const attrs = [`data={${qn}}`, `x=${ms[0]}`, `y=${ms[1]}`];
        if (ms[2]) attrs.push(`size=${ms[2]}`);
        attrs.push(`label=${dimAlias(vb.dims[0])}`);
        if (vb.dims[1]) attrs.push(`series=${dimAlias(vb.dims[1])}`);
        return `<BubbleChart ${attrs.join(' ')}/>`;
      }),
  },
  {
    id: 'group',
    label: 'Group (v1: tabela ordenada pelas dimensões)',
    queryCount: 1,
    requires: (vb) => need((vb.dims || []).length >= 2, 'precisa de ≥2 dimensões'),
    compile: (ctx) => oneQuery(ctx, (vb, qn) => dataTableBody(vb, qn)),
  },
  {
    id: 'freeform',
    label: 'Freeform (BigValues)',
    queryCount: 1,
    requires: (vb) => need((vb.metrics || []).length >= 1, 'precisa de ≥1 métrica'),
    compile: (ctx) =>
      oneQuery(ctx, (vb, qn) =>
        (vb.metrics || [])
          .map(
            (m) =>
              `<BigValue data={${qn}} value=${metricAlias(m)} title="${attrEsc(m.label || metricAlias(m))}"${m.fmt ? ` fmt=${m.fmt}` : ''}/>`
          )
          .join('\n')
      ),
  },
  {
    // Estilo por PAPÉIS: ignora a seleção do canvas — o SQL projeta as colunas
    // mapeadas (papel→coluna) direto da fonte.
    id: 'connectionmap',
    label: 'ConnectionMap (arcos geográficos)',
    queryCount: 1,
    roles: [
      { key: 'fromName', label: 'origem — nome', accepts: 'string' },
      { key: 'fromLat', label: 'origem — latitude', accepts: 'number' },
      { key: 'fromLon', label: 'origem — longitude', accepts: 'number' },
      { key: 'toName', label: 'destino — nome', accepts: 'string' },
      { key: 'toLat', label: 'destino — latitude', accepts: 'number' },
      { key: 'toLon', label: 'destino — longitude', accepts: 'number' },
      { key: 'weight', label: 'peso (largura do arco)', accepts: 'number', optional: true },
    ],
    requires: (vb, source) => checkRoles(vb, source, ['fromName', 'fromLat', 'fromLon', 'toName', 'toLat', 'toLon'], ['weight']),
    compile: (ctx) => {
      const vb = ctx.vb;
      const r = vb.roles || {};
      const name = vb.queries?.[0]?.name || vb.id;
      const keys = ['fromName', 'fromLat', 'fromLon', 'toName', 'toLat', 'toLon', ...(r.weight ? ['weight'] : [])];
      const cols = [...new Set(keys.map((k) => r[k]))];
      const sql = (ctx.ctePrefix || '') + 'select ' + cols.map(q).join(', ') + '\nfrom ' + q(vb.source.name) + whereOf(vb);
      const attrs = keys.map((k) => `${k}=${r[k]}`).join(' ');
      const map = r.map === 'brazil' ? 'brazil' : 'world';
      return { queries: [{ name, sql }], body: `<ConnectionMap data={${name}} map=${map} ${attrs}/>` };
    },
  },
  {
    // MULTI-QUERY (spec §4): nodes derivados dos dois lados das arestas + edges
    // no contrato do componente (source_id/target_id/target_name[/weight]).
    id: 'collabgraph',
    label: 'CollaborationGraph (rede, 2 queries)',
    queryCount: 2,
    roles: [
      { key: 'source', label: 'aresta — origem (id)', accepts: 'string' },
      { key: 'target', label: 'aresta — destino (id)', accepts: 'string' },
      { key: 'label', label: 'rótulo do destino', accepts: 'string', optional: true },
      { key: 'weight', label: 'peso da aresta', accepts: 'number', optional: true },
    ],
    requires: (vb, source) => checkRoles(vb, source, ['source', 'target'], ['label', 'weight']),
    compile: (ctx) => {
      const vb = ctx.vb;
      const r = vb.roles || {};
      const pre = ctx.ctePrefix || '';
      const src = q(vb.source.name);
      const W = whereOf(vb);
      const lbl = q(r.label || r.target);
      const nodesName = vb.id + '_nodes';
      const edgesName = vb.id + '_edges';
      const nodes =
        pre +
        `select distinct ${q(r.source)} as id, ${q(r.source)} as label from ${src}${W}\n` +
        `union\nselect distinct ${q(r.target)} as id, ${lbl} as label from ${src}${W}`;
      const edges =
        pre +
        `select ${q(r.source)} as source_id, ${q(r.target)} as target_id, ${lbl} as target_name` +
        (r.weight ? `, ${q(r.weight)} as weight` : '') +
        `\nfrom ${src}${W}`;
      const tag =
        `<CollaborationGraph nodes=${nodesName} edges=${edgesName} nodeId=id nodeLabel=label` +
        (r.weight ? ' edgeWeight=weight' : '') +
        ' layout="force-directed"/>';
      return { queries: [{ name: nodesName, sql: nodes }, { name: edgesName, sql: edges }], body: tag };
    },
  },
  {
    id: 'areamap',
    label: 'Mapa (Brasil por UF)',
    queryCount: 1,
    requires: (vb) => {
      const d = (vb.dims || [])[0];
      const geo = d && /(^|_)(uf|sigla)$/i.test(d.column);
      return need((vb.dims || []).length === 1 && (vb.metrics || []).length >= 1 && !!geo, 'precisa de 1 dimensão geográfica (uf/sigla) e ≥1 métrica');
    },
    compile: (ctx) =>
      oneQuery(ctx, (vb, qn) => `<AreaMap data={${qn}} areaCol=${dimAlias(vb.dims[0])} value=${metricAlias(vb.metrics[0])} geoId=sigla/>`),
  },
  {
    // NESTED (F3 §5): grão-pai × grão-filho numa ÚNICA query particionada —
    // nunca N+1. `limit por grupo` = row_number() over (partition by pai).
    // Compila para o container <Repeat>, que particiona no cliente nos 3
    // ambientes; trocar childStyle troca SÓ a tag (recompilação mais barata).
    id: 'nested',
    label: 'Nested (pai → filhos, 1 query)',
    queryCount: 1,
    requires: (vb) => {
      const n = vb.nested;
      if (!n || !(n.parent || []).length || !(n.child || []).length || !n.childStyle) {
        return { ok: false, needsRoles: true, reason: 'configure a divisão pai/filho e o estilo do filho (precisa de ≥2 dimensões e ≥1 métrica)' };
      }
      if ((vb.metrics || []).length < 1) return { ok: false, needsRoles: true, reason: 'precisa de ≥1 métrica (ordena o top-N por grupo)' };
      if (!['tabular', 'graph.bar', 'graph.line'].includes(n.childStyle))
        return { ok: false, needsRoles: true, reason: 'childStyle deve ser de query única: tabular, graph.bar ou graph.line' };
      return { ok: true };
    },
    compile: (ctx) => {
      const vb = ctx.vb;
      const n = vb.nested;
      const name = vb.queries?.[0]?.name || vb.id;
      const metric = metricAlias(vb.metrics[0]);
      const parents = n.parent.map(q).join(', ');
      const lim = Math.max(1, Number(n.limitPerGroup) || 10);
      const sql =
        `select * from (\n` +
        `  select b.*, row_number() over (partition by ${parents} order by ${q(metric)} desc) as _rn\n` +
        `  from (\n${String(ctx.baseSql).trim().split('\n').map((l) => '    ' + l).join('\n')}\n  ) b\n` +
        `) t\nwhere _rn <= ${lim}\norder by ${parents}, _rn`;
      const childX = n.child[0];
      const attrs = [
        `data={${name}}`,
        `by="${attrEsc(n.parent.join(','))}"`,
        `childStyle=${n.childStyle}`,
        `x=${childX}`,
        `y=${metric}`,
        `maxGroups=${Number(n.maxGroups) || 50}`,
      ].join(' ');
      return { queries: [{ name, sql }], body: `<Repeat ${attrs}/>` };
    },
  },
  {
    // Pivot com COLUNAS CONGELADAS (spec §5): crosstab "static" da DataWindow.
    // O domínio da dimensão-coluna é congelado no marcador (frozenCols); compila
    // para agregação condicional — filtros mudam VALORES, nunca o conjunto de
    // colunas (layout estável em qualquer publish). "Outros" agrega o resto.
    id: 'pivot',
    label: 'Pivot (linhas × colunas × métrica)',
    queryCount: 1,
    requires: (vb) => {
      const p = vb.pivot;
      if (!p || !(p.rows || []).length || !p.cols || !p.measure) {
        return { ok: false, needsRoles: true, reason: 'configure linhas × colunas × métrica (e congele as colunas)' };
      }
      if (!(p.frozenCols || []).length) {
        return { ok: false, needsRoles: true, reason: 'congele as colunas (↻) — o domínio vira parte do marcador' };
      }
      return { ok: true };
    },
    compile: (ctx) => {
      const vb = ctx.vb;
      const p = vb.pivot;
      const name = vb.queries?.[0]?.name || vb.id;
      const aliasQ = (v) => '"' + String(v).replace(/"/g, '""') + '"';
      const lit = (v) => "'" + escapeSqlValue(String(v)) + "'";
      const colExpr = `cast(${q(p.cols)} as varchar)`;
      const aggOf = (cond) =>
        p.measure.agg === 'count_distinct'
          ? `count(distinct case when ${cond} then ${q(p.measure.column)} end)`
          : `${p.measure.agg}(case when ${cond} then ${q(p.measure.column)} end)`;
      const frozen = p.frozenCols || [];
      const selects = [
        ...p.rows.map((r) => q(r)),
        ...frozen.map((v) => `${aggOf(`${colExpr} = ${lit(v)}`)} as ${aliasQ(v)}`),
        ...(p.others !== false ? [`${aggOf(`${colExpr} not in (${frozen.map(lit).join(', ')})`)} as ${aliasQ('Outros')}`] : []),
      ];
      const sql =
        (ctx.ctePrefix || '') +
        'select ' + selects.join(',\n       ') +
        '\nfrom ' + q(vb.source.name) +
        whereOf(vb) +
        '\ngroup by ' + p.rows.map((_, i) => i + 1).join(', ') +
        '\norder by ' + p.rows.map((_, i) => i + 1).join(', ');
      const cols = [
        ...p.rows.map((r) => `  <Column id=${r}/>`),
        ...frozen.map((v) => `  <Column id="${attrEsc(v)}"/>`),
        ...(p.others !== false ? ['  <Column id="Outros"/>'] : []),
      ];
      return { queries: [{ name, sql }], body: `<DataTable data={${name}}>\n${cols.join('\n')}\n</DataTable>` };
    },
  },
];

export const styleById = (id) => STYLES.find((s) => s.id === id) || null;

function oneQuery(ctx, bodyFn) {
  const vb = ctx.vb;
  const name = vb.queries?.[0]?.name || vb.id;
  return { queries: [{ name, sql: ctx.baseSql }], body: bodyFn(vb, name) };
}

// params (Passo 3) -----------------------------------------------------------
// v1: só enum. Declaração → input derivado: query de opções + <Dropdown> com
// "Todos" (%) e predicado LIKE no SQL (injetado pelo sqlgen via buildSql(..., params)).

export function paramOptsQueryName(vb, p) {
  return `${vb.id}_${p.name}_opts`;
}

/**
 * `ctePrefix`: para fontes kind query/model, o SQL da fonte vira CTE — o
 * prefixo (`with "nome" as (...)\n`) entra em TODAS as queries do bloco.
 */
export function compileParamInputs(vb, ctePrefix = '', optsSqlFor = null) {
  const segments = [];
  for (const p of vb.params || []) {
    const title = attrEsc(p.label || p.name);
    if (p.type === 'enum') {
      const optsName = paramOptsQueryName(vb, p);
      const optsSql = optsSqlFor
        ? optsSqlFor(p)
        : ctePrefix +
          `select distinct cast(${q(p.from)} as varchar) as value\nfrom ${q(vb.source.name)}\nwhere ${q(p.from)} is not null\norder by 1`;
      segments.push('```sql ' + optsName + '\n' + optsSql + '\n```');
      const todos = (p.default ?? '%') === '%' ? '<DropdownOption value="%" valueLabel="Todos"/>' : '';
      segments.push(`<Dropdown name=${p.name} data={${optsName}} value=value title="${title}">${todos}</Dropdown>`);
    } else if (p.type === 'text') {
      segments.push(`<TextInput name=${p.name} title="${title}" defaultValue="${attrEsc(p.default ?? '%')}"/>`);
    } else if (p.type === 'number') {
      const min = p.min ?? 0;
      const max = p.max ?? 100;
      const step = p.step ?? 1;
      segments.push(`<Slider name=${p.name} title="${title}" min=${min} max=${max} step=${step} defaultValue=${p.default ?? min}/>`);
    } else if (p.type === 'date') {
      segments.push(`<DateRange name=${p.name} title="${title}"/>`);
    } else {
      throw new Error(`Tipo de argumento desconhecido: ${p.type}`);
    }
  }
  return segments;
}

// compilador ------------------------------------------------------------------

/**
 * Compila o View Block completo (marcador + inputs + células sql + body +
 * fechamento) na forma canônica. `ctx = { vb, source, baseSql }` — o baseSql
 * já vem com os predicados dos params (sqlgen buildSql(model, sel, params)).
 */
export function compileViewblock(vb, ctx) {
  const style = styleById(vb.style);
  if (!style) throw new Error(`Estilo desconhecido: ${vb.style}`);
  const r = style.requires(vb, ctx.source);
  if (!r.ok) throw new Error(`Seleção não atende o contrato de "${vb.style}": ${r.reason}`);

  const paramSegments = compileParamInputs(vb, ctx.ctePrefix || '', ctx.optsSqlFor || null);
  const compiled = style.compile({ ...ctx, vb });

  // o marcador registra as queries REALMENTE emitidas (multi-query na F2/M7)
  const meta = { ...vb, queries: compiled.queries.map(({ name }) => ({ name, sql: null })) };

  const segments = [
    serializeVbMeta(meta),
    ...paramSegments,
    ...compiled.queries.map((cq) => '```sql ' + cq.name + '\n' + String(cq.sql).trim() + '\n```'),
    compiled.body,
    '<!-- /viewblock -->',
  ];
  return segments.join('\n\n');
}
