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
  const hasMeta = (vb.metrics || []).some((m) => m.label || m.fmt) || (vb.dims || []).some((d) => d.label);
  if (!hasMeta) return `<DataTable data={${qname}}/>`;
  const cols = [
    ...(vb.dims || []).map((d) => `  <Column id=${dimAlias(d)}${d.label ? ` title="${attrEsc(d.label)}"` : ''}/>`),
    ...(vb.metrics || []).map(
      (m) => `  <Column id=${metricAlias(m)}${m.label ? ` title="${attrEsc(m.label)}"` : ''}${m.fmt ? ` fmt=${m.fmt}` : ''}/>`
    ),
  ];
  return `<DataTable data={${qname}}>\n${cols.join('\n')}\n</DataTable>`;
}

function chartBody(tag, vb, qname) {
  const x = dimAlias(vb.dims[0]);
  const ms = vb.metrics || [];
  const ys = ms.map(metricAlias);
  const y = ys.length === 1 ? ys[0] : `{${JSON.stringify(ys)}}`;
  // Paridade com <Column>/<BigValue>: fmt e label da métrica chegam ao gráfico.
  // yFmt só quando TODAS as métricas compartilham o fmt (um eixo, um formato);
  // seriesLabels quando alguma métrica tem label (legenda legível, não o alias).
  const fmts = [...new Set(ms.map((m) => m.fmt || ''))];
  const yFmt = fmts.length === 1 && fmts[0] ? ` yFmt=${fmts[0]}` : '';
  const labels = ms.some((m) => m.label) ? ` seriesLabels={${JSON.stringify(ms.map((m) => m.label || metricAlias(m)))}}` : '';
  return `<${tag} data={${qname}} x=${x} y=${y}${yFmt}${labels}/>`;
}

// registro ------------------------------------------------------------------

export const STYLES = [
  {
    id: 'tabular',
    label: 'Tabular',
    question: 'detalhe/listagem para consulta, valor a valor',
    breaks: [
      { quando: 'a pergunta é comparação, não consulta — a tabela esconde a forma', use: 'graph.bar' },
    ],
    queryCount: 1,
    requires: (vb) => need((vb.dims || []).length >= 1 && (vb.metrics || []).length >= 1, 'precisa de ≥1 dimensão e ≥1 métrica'),
    compile: (ctx) => oneQuery(ctx, (vb, qn) => dataTableBody(vb, qn)),
  },
  {
    id: 'graph.bar',
    label: 'Graph · barras',
    question: 'ranking / comparação entre categorias',
    breaks: [
      { quando: 'há VÁRIAS observações por grupo — a barra, mesmo com barra de erro, esconde a dispersão', use: 'graph.range' },
      { quando: 'passa de ~40 categorias', use: 'tabular' },
    ],
    fallback: 'tabular',
    queryCount: 1,
    requires: (vb) => need((vb.dims || []).length === 1 && (vb.metrics || []).length >= 1, 'precisa de exatamente 1 dimensão e ≥1 métrica'),
    compile: (ctx) => oneQuery(ctx, (vb, qn) => chartBody('BarChart', vb, qn)),
  },
  {
    id: 'graph.line',
    label: 'Graph · linha (tempo)',
    question: 'evolução ao longo do tempo',
    breaks: [
      { quando: 'passa de ~5 séries — vira espaguete e nenhuma fica legível', use: 'nested' },
    ],
    fallback: 'tabular',
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
    question: 'posição em DUAS medidas (ex.: volume × eficiência)',
    breaks: [
      { quando: 'a 3ª métrica precisa ser LIDA com precisão — área é mal percebida, ela só ordena', use: 'tabular' },
    ],
    fallback: 'tabular',
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
    question: 'cruzamento de 2+ dimensões',
    fallback: 'tabular',
    queryCount: 1,
    requires: (vb) => need((vb.dims || []).length >= 2, 'precisa de ≥2 dimensões'),
    compile: (ctx) => oneQuery(ctx, (vb, qn) => dataTableBody(vb, qn)),
  },
  {
    id: 'freeform',
    label: 'Freeform (BigValues)',
    question: 'número de cabeçalho, sem recorte',
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
    question: 'origem → destino geográfico',
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
    question: 'rede de conexões entre nós',
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
    question: 'distribuição geográfica por UF',
    breaks: [
      { quando: 'a métrica é CONTAGEM ABSOLUTA — o mapa colore população e tamanho da UF, não a taxa; use uma métrica normalizada (por habitante, por instituição, % do total)', use: 'graph.bar' },
    ],
    fallback: 'graph.bar',
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
    // INTERVALO: a forma que consome a dispersão do catálogo (p25/mediana/p75).
    // Convenção de ordem, como no graph.bubble — sem papéis a configurar:
    //   métrica 1 = mínimo · métrica 2 = centro · métrica 3 = máximo
    // Três barras lado a lado mostram três números; uma haste mostra a FAIXA.
    id: 'graph.range',
    label: 'Graph · intervalo (faixa + centro)',
    question: 'a FAIXA onde os valores caem, não só a média',
    breaks: [
      { quando: 'a pergunta é a FORMA da distribuição (bimodal? cauda?) — três números não a mostram', use: 'graph.histogram' },
    ],
    fallback: 'tabular',
    queryCount: 1,
    requires: (vb) =>
      need(
        (vb.dims || []).length === 1 && (vb.metrics || []).length === 3,
        'precisa de 1 dimensão e EXATAMENTE 3 métricas, na ordem mínimo · centro · máximo (ex.: p25, mediana, p75)'
      ),
    compile: (ctx) =>
      oneQuery(ctx, (vb, qn) => {
        const [lo, mid, hi] = (vb.metrics || []).map(metricAlias);
        const fmt = (vb.metrics || [])[1]?.fmt;
        return `<RangeChart data={${qn}} x=${dimAlias(vb.dims[0])} low=${lo} mid=${mid} high=${hi}${fmt ? ` yFmt=${fmt}` : ''}/>`;
      }),
  },
  {
    id: 'graph.bump',
    label: 'Graph · posição no ranking (bump)',
    question: 'quem SUBIU e quem CAIU no ranking entre períodos',
    breaks: [
      { quando: 'só há UM período no recorte — sem comparação não há movimento', use: 'graph.bar' },
    ],
    fallback: 'tabular',
    planHint: '2 dimensões — uma TEMPORAL (eixo) e a entidade rankeada (uma linha cada) — e 1 métrica que seja uma POSIÇÃO declarada no catálogo (derivada posicao(m, nível)). Se o catálogo não tiver nenhuma, NÃO use este estilo e diga isso em warnings. Use bump: {top: 10} para cortar o topo.',
    queryCount: 1,
    // 2 dimensões: o tempo (eixo) e a entidade rankeada (uma linha cada).
    // 1 métrica: a POSIÇÃO. Não é "faturamento ao longo do tempo" com outro
    // eixo — é outra pergunta, e a métrica precisa ser uma posicao() do catálogo
    // (quem verifica isso é quem tem o catálogo: reportPlan e o funil).
    requires: (vb, source) => {
      const ds = vb.dims || [];
      const temporal = ds.filter((d) => isTemporalDim(d, source));
      return need(
        ds.length === 2 && temporal.length >= 1 && (vb.metrics || []).length === 1,
        'precisa de 2 dimensões (uma TEMPORAL = eixo, outra = quem é rankeado) e 1 métrica de POSIÇÃO (posicao(...) do catálogo)'
      );
    },
    compile: (ctx) => {
      const vb = ctx.vb;
      const name = vb.queries?.[0]?.name || vb.id;
      const tempo = (vb.dims || []).find((d) => isTemporalDim(d, ctx.source)) || vb.dims[0];
      const ent = (vb.dims || []).find((d) => d !== tempo);
      const x = dimAlias(tempo);
      const m = (vb.metrics || [])[0] || {};
      // Mesma razão do graph.line: o SQL da fonte ordena por métrica desc, e num
      // eixo de tempo isso embaralha a série. Reordena CRONOLOGICAMENTE por fora.
      const sql = `select * from (\n${ctx.baseSql}\n) t\norder by ${q(x)}`;
      return {
        queries: [{ name, sql }],
        body: `<LineChart data={${name}} x=${x} y=${metricAlias(m)} series=${dimAlias(ent)} yInverted=true yAxisTitle="${attrEsc(m.label || 'Posição')}"/>`,
      };
    },
  },
  {
    id: 'graph.histogram',
    label: 'Graph · distribuição (histograma)',
    question: 'a FORMA da distribuição de uma medida (onde os valores se concentram)',
    breaks: [
      { quando: 'a comparação é ENTRE grupos — vários histogramas não cabem num eixo só', use: 'graph.range' },
    ],
    fallback: 'graph.range',
    planHint: 'UMA única métrica. NÃO acrescente p25/mediana/p75 ao lado: a forma já mostra isso, e o bloco com 2+ métricas é RECUSADO. A métrica só NOMEIA A COLUNA a observar; a agregação dela não é aplicada — o histograma conta as LINHAS DO FATO uma a uma, pelo valor BRUTO da coluna, não por médias nem totais. Portanto NÃO escreva ressalvas dizendo que ele reflete valores agregados: ele não reflete. Use uma métrica sum/avg/min/max da medida (nunca contagem, nunca derivada) e distribution: {bins: N}, N de 5 a 100 (~24).',
    queryCount: 1,
    // 1 métrica: é o PONTEIRO para a coluna observada, não uma série.
    // 0 dimensões: comparar distribuições entre grupos é pequenos múltiplos,
    // não um eixo com grupo×faixa (5 regiões × 24 faixas = 120 barras ilegíveis).
    requires: (vb) =>
      need(
        (vb.metrics || []).length === 1 && !(vb.dims || []).length,
        'precisa de EXATAMENTE 1 métrica (a medida observada) e NENHUMA dimensão — as faixas já são o eixo'
      ),
    compile: (ctx) =>
      oneQuery(ctx, (vb, qn) => {
        const m = (vb.metrics || [])[0] || {};
        const titulo = m.label ? ` xAxisTitle="${attrEsc(m.label)}"` : '';
        // contiguous: as barras se encostam. É o que distingue, para quem lê,
        // uma escala CONTÍNUA fatiada de categorias independentes.
        return `<BarChart data={${qn}} x=faixa y=observacoes yFmt=num0 contiguous=true${titulo} seriesLabels={["Observações"]}/>`;
      }),
  },
  {
    // NESTED (F3 §5): grão-pai × grão-filho numa ÚNICA query particionada —
    // nunca N+1. `limit por grupo` = row_number() over (partition by pai).
    // Compila para o container <Repeat>, que particiona no cliente nos 3
    // ambientes; trocar childStyle troca SÓ a tag (recompilação mais barata).
    id: 'nested',
    label: 'Nested (pai → filhos, 1 query)',
    question: 'o MESMO recorte repetido para MUITOS grupos, lado a lado',
    breaks: [
      { quando: 'há menos de ~3 grupos — pequenos múltiplos não compensam', use: 'group' },
    ],
    fallback: 'group',
    planHint: 'declare AS DUAS dimensões em "dims" e repita os nomes em nested.parent (o que separa os painéis) e nested.child (o eixo dentro de cada painel). childStyle: tabular | graph.bar | graph.line. Use limitPerGroup ~6 e maxGroups ~12. Os painéis dividem a MESMA escala, então servem para comparar grupos.',
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
    question: 'matriz linhas × colunas com uma métrica',
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
  // O erro aponta a SAÍDA, não só o que falta: `fallback` é o estilo mais
  // simples que sempre serve para a mesma seleção.
  if (!r.ok)
    throw new Error(
      `Seleção não atende o contrato de "${vb.style}": ${r.reason}` +
        (style.fallback ? ` — para esta seleção, use "${style.fallback}"` : '')
    );

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

// ---------------------------------------------------------------------------
// MENU DO AGENTE, GERADO DO REGISTRO.
//
// Antes, o prompt do planejador repetia à mão o que o registro já dizia em
// código: a lista de estilos, o contrato de cada um e as instruções de config.
// Toda frente nova (graph.range, graph.histogram, graph.bump) exigia editar os
// dois — e um dos dois ia ficar para trás. Agora há uma fonte só.
//
// O texto do CONTRATO é o `reason` do próprio `requires()` — a mesma string que
// o compilador devolve ao recusar. Não dá para o prompt prometer uma coisa e a
// validação cobrar outra: é o mesmo objeto.
//
// `question` diz quando escolher; `breaks` diz o que INVALIDA o estilo mesmo
// com o contrato atendido (condições que dependem do DADO, não da seleção, que
// é justamente o que requires() não alcança); `fallback` diz para onde ir.
export function styleMenuLines(ids) {
  const sel = (ids || STYLES.map((s) => s.id)).map(styleById).filter(Boolean);
  const vazio = { dims: [], metrics: [], params: [], roles: {}, source: { kind: 'semantic' } };
  const fonte = { name: '', columns: [] };
  const contratoDe = (s) => {
    try {
      const r = s.requires(vazio, fonte);
      return r.ok ? 'sem exigência de aridade' : r.reason;
    } catch {
      return 'sem exigência de aridade';
    }
  };
  // Quebra em ~105 colunas, indentando a continuação — um prompt com linhas de
  // 190 colunas fica ilegível e o modelo perde o fim da frase.
  // A PRIMEIRA linha fica rente à margem (é um marcador de primeiro nível);
  // só as continuações são indentadas.
  const envolve = (texto, indent) => {
    const linhas = [];
    let linha = '';
    for (const p of String(texto).split(' ')) {
      if (linha && (linha + ' ' + p).length > 105) {
        linhas.push((linhas.length ? indent : '') + linha);
        linha = '';
      }
      linha = linha ? linha + ' ' + p : p;
    }
    if (linha) linhas.push((linhas.length ? indent : '') + linha);
    return linhas;
  };
  // TRÊS visões, não uma. Medido: colapsar tudo num bloco indentado por estilo
  // — tudo no mesmo peso visual — fez o planejador violar contrato em 4 de 4
  // execuções e parar de escolher graph.histogram. Cada visão tem um trabalho:
  // o cardápio serve para ESCOLHER, os contratos para não violar aridade, os
  // "não use" para não errar a premissa. A fonte continua sendo uma só.
  const largura = 58;
  const out = ['- ESCOLHA O ESTILO PELA PERGUNTA, não por hábito. Tabela e barra NÃO são o padrão:'];
  for (const s of sel) {
    const q = s.question || s.label;
    out.push(`    · ${q} ${'.'.repeat(Math.max(1, largura - q.length))} ${s.id}`);
  }
  out.push(
    ...envolve(
      '- CONTRATOS (o compilador RECUSA o bloco que não atender): ' +
        sel.map((s) => `${s.id} ${contratoDe(s).replace(/^precisa de /, 'precisa de ')}`).join('; ') +
        '.',
      '  '
    )
  );
  const naoUse = sel.flatMap((s) => (s.breaks || []).map((b) => `${s.id} quando ${b.quando} → use ${b.use}`));
  if (naoUse.length) out.push(...envolve('- NÃO use: ' + naoUse.join('; ') + '.', '  '));
  for (const s of sel) if (s.planHint) out.push(...envolve(`- ${s.id}: ${s.planHint}`, '  '));
  return out;
}
