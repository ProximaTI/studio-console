// Compilador de relatório (F5, M28): a ÚNICA regra de geração semântica —
// o web (vbState) delega para cá; o server compila planos multipágina com o
// mesmo código. IA nunca gera SQL/Markdown: tudo sai daqui, determinístico.
import { compileViewblock } from './viewStyles.js';
import { compileCatalogSql, dimAliasOf, dimExprOf, metricInfo } from './semanticCompile.js';

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
    dims: catSel.dims.map((s) => ({ dim: s.dim, ...(s.level ? { level: s.level } : {}), alias: dimAliasOf(catalog, s), column: dimAliasOf(catalog, s), table: catalog.fact })),
    metrics: catSel.metrics.map((n) => metricInfo(catalog, n)),
    filters,
    limit: limit ?? 1000,
    params,
    style,
    ...(roles && Object.keys(roles).length ? { roles } : {}),
    ...(pivot ? { pivot } : {}),
    ...(nested ? { nested } : {}),
    children: [],
  };
  const baseSql = compileCatalogSql({
    catalog,
    hash,
    metrics: catSel.metrics,
    dims: catSel.dims,
    filters,
    params: [...params, ...quietParams],
    factColumns: cols,
    limit: limit ?? 1000,
  });
  // opts de param enum: expressão da DIMENSÃO sobre o fato (não coluna crua)
  const optsSqlFor = (p) => {
    const [dimName, level] = String(p.from).split('.');
    const expr = dimExprOf(catalog, { dim: dimName, level }, cols);
    return `select distinct cast(${expr} as varchar) as value\nfrom "${String(catalog.fact).replace(/"/g, '')}"\nwhere ${expr} is not null\norder by 1`;
  };
  return compileViewblock(vb, { vb, source: src, baseSql, optsSqlFor });
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
      if (pg.parameter) filters.push({ dim: pg.parameter.dimension, values: ['${params.' + pg.parameter.name + '}'] });
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
        const expr = dimExprOf(catalog, { dim: pp.parameter.dimension }, factColumns || []);
        const alias = dimAliasOf(catalog, { dim: pp.parameter.dimension });
        const qn = 'nav_' + nome;
        partes.push(`## ${pp.title}`);
        partes.push(
          '```sql ' + qn + '\n' +
            `select distinct cast(${expr} as varchar) as ${alias}, '/${nome}/' || cast(${expr} as varchar) || '/' as link\n` +
            `from "${String(catalog.fact).replace(/"/g, '')}"\nwhere ${expr} is not null\norder by 1\n` +
            '```'
        );
        partes.push(`<DataTable data={${qn}} link=link><Column id=${alias} title="${pp.title}"/></DataTable>`);
      }
    }
    out.push({ path: outPathOf(pg), content: partes.join('\n\n') + '\n' });
  }
  return out;
}
