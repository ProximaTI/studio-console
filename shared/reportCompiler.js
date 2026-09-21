// Compilador de relatório (F5, M28): a ÚNICA regra de geração semântica —
// o web (vbState) delega para cá; o server compila planos multipágina com o
// mesmo código. IA nunca gera SQL/Markdown: tudo sai daqui, determinístico.
import { compileViewblock } from './viewStyles.js';
import {
  compileCatalogSql,
  compileDistributionSql,
  compileFilterPreds,
  dimAliasOf,
  dimExprOf,
  isRankMetric,
  metricInfo,
} from './semanticCompile.js';

function hash6(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(6, '0').slice(-6);
}

/**
 * Compila UM bloco semântico (marcador + inputs + célula sql + tag) na forma
 * canônica. Extraído de web/src/wizard/vbState.ts (M28) — os shapes do
 * marcador são idênticos byte a byte aos que o wizard sempre gravou.
 *
 * `params` entram no marcador E viram inputs na página; `quietParams` só
 * predicam o SQL (inputs compartilhados emitidos uma vez por página — padrão
 * documentado da demo apc_semantico).
 */
export function compileSemanticBlock({
  catalog,
  hash,
  factColumns,
  sourceInfo,
  catSel,
  filters = [],
  params = [],
  quietParams = [],
  style,
  roles,
  pivot,
  nested,
  distribution,
  bump,
  table,
  order,
  reference,
  stack,
  orientation,
  limit,
  vbId,
  ref,
}) {
  const cols = factColumns || (sourceInfo ? sourceInfo.columns.map((c) => c.name) : []);
  const src = sourceInfo || { name: catalog.fact, columns: cols.map((n) => ({ name: n, type: '' })) };
  const id = vbId || 'vb_' + hash6(JSON.stringify([catalog.model, catSel, params, style]));
  const vb = {
    v: 1,
    id,
    source: { kind: 'semantic', name: catalog.model, ...(ref ? { ref } : {}) },
    catalogHash: hash,
    queries: [{ name: id, sql: null }],
    // `label` vem do catálogo: sem ele a tabela mostrava o nome CRU da coluna
    // (country_name) no cabeçalho, enquanto as métricas já exibiam o rótulo.
    dims: catSel.dims.map((s) => ({
      dim: s.dim,
      ...(s.level ? { level: s.level } : {}),
      alias: dimAliasOf(catalog, s),
      column: dimAliasOf(catalog, s),
      table: catalog.fact,
      ...((catalog.dimensions || {})[s.dim]?.label ? { label: catalog.dimensions[s.dim].label } : {}),
    })),
    metrics: catSel.metrics.map((n) => metricInfo(catalog, n)),
    filters,
    limit: limit ?? 1000,
    params,
    style,
    ...(roles && Object.keys(roles).length ? { roles } : {}),
    ...(pivot ? { pivot } : {}),
    ...(nested ? { nested } : {}),
    ...(distribution ? { distribution } : {}),
    ...(bump ? { bump } : {}),
    ...(table ? { table } : {}),
    ...(order && order.length ? { order } : {}),
    ...(reference && reference.length ? { reference } : {}),
    ...(stack ? { stack } : {}),
    ...(orientation ? { orientation } : {}),
    children: [],
  };
  // A bifurcação do produto vive AQUI, no funil, e em nenhum outro lugar: um
  // histograma conta observações por faixa, o que precisa das linhas do fato
  // antes do group by — não dá para embrulhar a base agregada. O registro de
  // estilos segue puramente apresentacional, recebendo um SQL pronto.
  // graph.bump consome uma métrica de POSIÇÃO. O contrato do estilo só vê
  // aridade (o viewblock não carrega a definição da métrica); quem sabe o que
  // ela É é o catálogo, e ele está aqui.
  if (style === 'graph.bump' && !isRankMetric(catalog, catSel.metrics[0]))
    throw new Error(
      `graph.bump precisa de uma métrica de posição: declare no catálogo uma derivada ` +
        `posicao(<métrica>, <nível>) — "${catSel.metrics[0]}" não é uma.`
    );
  const baseSql =
    style === 'graph.histogram'
      ? compileDistributionSql({
          catalog,
          hash,
          metric: catSel.metrics[0],
          bins: distribution?.bins,
          filters,
          params: [...params, ...quietParams],
          factColumns: cols,
        })
      : compileCatalogSql({
          catalog,
          hash,
          metrics: catSel.metrics,
          dims: catSel.dims,
          filters,
          params: [...params, ...quietParams],
          factColumns: cols,
          limit: limit ?? 1000,
          rankTop: bump?.top,
          order,
        });
  // opts de param enum: expressão da DIMENSÃO sobre o fato (não coluna crua)
  const optsSqlFor = (p) => {
    const [dimName, level] = String(p.from).split('.');
    const expr = dimExprOf(catalog, { dim: dimName, level }, cols);
    return `select distinct cast(${expr} as varchar) as value\nfrom "${String(catalog.fact).replace(/"/g, '')}"\nwhere ${expr} is not null\norder by 1`;
  };
  // `filterPreds`: os estilos que montam o próprio SQL (pivot, connectionmap,
  // collabgraph) não embrulham o baseSql e por isso não herdam o `where` dos
  // filtros — recebem os predicados já traduzidos pelo catálogo.
  return compileViewblock(vb, { vb, source: src, baseSql, optsSqlFor, filterPreds: compileFilterPreds(catalog, filters, cols) });
}

/** Caminho REAL gravado (D29): parametrizada normaliza p/ subpasta canônica. */
export function outPathOf(pg) {
  return pg.parameter ? `${pg.parameter.name}/[${pg.parameter.name}].md` : pg.path;
}

/** Rota estilo Evidence de uma página do plano (index.md → '/'). */
function routeOf(pg) {
  if (pg.path === 'index.md') return '/';
  return '/' + String(pg.path).replace(/\.md$/i, '') + '/';
}

/**
 * Compila um ReportPlan VALIDADO em páginas completas. Determinístico:
 * mesmo plano + mesmo catálogo ⇒ arquivos byte-idênticos.
 * F5.1 (M34): relatório multipágina ganha NAVEGAÇÃO gerada — linha de links
 * (rota absoluta /pagina/, o dialeto que funciona nos 3 ambientes) em toda
 * página, e índice de valores clicáveis para cada página parametrizada na
 * primeira página comum.
 * @returns {[{path, content}]}
 */
export function compileReport(plan, { catalog, hash, factColumns }) {
  const gp = plan.globalParams || [];
  const pages = plan.pages || [];
  const comuns = pages.filter((p) => !p.parameter);
  const paramPgs = pages.filter((p) => p.parameter);
  // parametrizada não entra na barra (precisa de valor) — o acesso é o índice
  const navLine =
    pages.length > 1 && comuns.length
      ? '**Páginas:** ' + comuns.map((p) => `[${p.title}](${routeOf(p)})`).join(' · ')
      : null;
  const indexHost = comuns[0] || null;

  const out = [];
  for (const pg of pages) {
    const partes = [`# ${pg.title}`];
    if (pg.parameter) partes[0] = `# ${pg.title} — {params.${pg.parameter.name}}`;
    if (navLine) partes.push(navLine);
    if (pg.purpose) partes.push(String(pg.purpose).trim());
    // F6 (D33): prosa AUTORAL da spec (campo de humanos — fora do schema do LLM)
    if (pg.prose && String(pg.prose).trim()) partes.push(String(pg.prose).trim());
    (pg.blocks || []).forEach((b, i) => {
      if (b.title) partes.push(`## ${b.title}`);
      const filters = [...(b.filters || [])];
      // página parametrizada: o valor vem da rota (/nome/valor/) via templating —
      // '${params.x}' atravessa o compilador intacto e resolve no runtime.
      // O nível acompanha o filtro INJETADO: sem ele, uma página por ano
      // compararia a coluna crua (uma data) com "2024".
      if (pg.parameter)
        filters.push({
          dim: pg.parameter.dimension,
          ...(pg.parameter.level ? { level: pg.parameter.level } : {}),
          values: ['${params.' + pg.parameter.name + '}'],
        });
      partes.push(
        compileSemanticBlock({
          catalog,
          hash,
          factColumns,
          catSel: {
            metrics: b.metrics || [],
            dims: (b.dims || []).map((d) => ({ dim: d.dim, ...(d.level ? { level: d.level } : {}) })),
          },
          filters,
          params: i === 0 ? gp : [],
          quietParams: i === 0 ? [] : gp,
          style: b.style,
          roles: b.roles,
          pivot: b.pivot,
          nested: b.nested,
          distribution: b.distribution,
          bump: b.bump,
          table: b.table,
          order: b.order,
          reference: b.reference,
          stack: b.stack,
          orientation: b.orientation,
          limit: b.limit,
          vbId: b.id ? 'vb_' + b.id : undefined,
        })
      );
    });
    // índice das páginas parametrizadas: valores clicáveis (rota /nome/valor/)
    // na primeira página comum — sem isso a [param].md ficaria inacessível.
    if (pg === indexHost) {
      for (const pp of paramPgs) {
        const nome = pp.parameter.name;
        // O índice tem de listar os MESMOS valores que a página filtra: se a
        // página recorta por ano, o índice lista anos, não datas.
        const pref = { dim: pp.parameter.dimension, ...(pp.parameter.level ? { level: pp.parameter.level } : {}) };
        const expr = dimExprOf(catalog, pref, factColumns || []);
        const alias = dimAliasOf(catalog, pref);
        const qn = 'nav_' + nome;
        partes.push(`## ${pp.title}`);
        partes.push(
          '```sql ' + qn + '\n' +
            `select distinct cast(${expr} as varchar) as ${alias}, '/${nome}/' || cast(${expr} as varchar) || '/' as link\n` +
            `from "${String(catalog.fact).replace(/"/g, '')}"\nwhere ${expr} is not null\norder by 1\n` +
            '```'
        );
        // search=true: o índice pode ter centenas de valores — busca client-side;
        // a paginação (rows=N, padrão 50) é do próprio DataTable nos 3 ambientes.
        partes.push(`<DataTable data={${qn}} link=link search=true><Column id=${alias} title="${pp.title}"/></DataTable>`);
      }
    }
    out.push({ path: outPathOf(pg), content: partes.join('\n\n') + '\n' });
  }
  return out;
}
