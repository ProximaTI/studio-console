// ReportPlan v1 (F5, D21): contrato do relatório PLANEJADO pela IA — só
// intenções e referências semânticas (nomes do catálogo, filtros {dim, level?,
// values[]}, estilos por id do registro). SEM SQL, SEM Markdown: quem gera é o
// compilador determinístico. Plano inválido volta com erros para revisão —
// nunca é "consertado" em silêncio.
import { internalDims, hierarchyOf } from './semanticCatalog.js';
import { styleById } from './viewStyles.js';
import { dimAliasOf } from './semanticCompile.js';

export const REPORT_LIMITS = { pages: 8, blocksPerPage: 8 };

const IDENT = /^[a-z_][a-z0-9_]*$/i;
const PATH_RE = /^[a-z0-9_\-]+\.md$|^\[[a-z_][a-z0-9_]*\]\.md$/i;
const PARAM_TYPES = new Set(['enum', 'text', 'number', 'date']);

/**
 * Valida um ReportPlan contra o catálogo REAL e o registro de estilos.
 * @param {object} plan
 * @param {{catalog: object|null, factColumns?: string[]}} ctx
 * @returns {[{path, message}]} — vazio = válido.
 */
export function validateReportPlan(plan, { catalog, factColumns } = {}) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!plan || typeof plan !== 'object') return [{ path: '', message: 'plano vazio ou inválido' }];

  if (plan.version !== 1) err('version', 'deve ser 1');
  if (!plan.title || typeof plan.title !== 'string') err('title', 'obrigatório');
  if (!['public', 'internal'].includes(plan.visibility)) err('visibility', 'public ou internal');
  if (!catalog) {
    err('catalog', `modelo "${plan.catalog}" não encontrado ou inválido no projeto`);
    return errors; // sem catálogo não há mais o que validar
  }
  if (plan.catalog !== catalog.model) err('catalog', `plano referencia "${plan.catalog}" mas o catálogo resolvido é "${catalog.model}"`);

  const dims = catalog.dimensions || {};
  const mets = catalog.metrics || {};
  const internas = internalDims(catalog);
  const publico = plan.visibility === 'public';
  const source = { name: catalog.fact, columns: (factColumns || []).map((n) => ({ name: n, type: '' })) };

  const checkDimRef = (path, ref, uso) => {
    if (!ref || !dims[ref.dim]) {
      err(path + '.dim', `dimensão "${ref?.dim}" não existe no modelo ${catalog.model}`);
      return false;
    }
    if (ref.level && !(dims[ref.dim].hierarchy || []).includes(ref.level)) {
      err(path + '.level', `nível "${ref.level}" não existe na hierarquia de "${ref.dim}"`);
      return false;
    }
    if (publico && internas.has(ref.dim)) err(path + '.dim', `"${ref.dim}" é interna (pii/expose) — proibida em ${uso} de relatório PÚBLICO`);
    return true;
  };

  const checkParam = (path, p) => {
    if (!p || !IDENT.test(String(p.name || ''))) err(path + '.name', 'identificador obrigatório');
    if (!PARAM_TYPES.has(p?.type)) err(path + '.type', 'enum | text | number | date');
    const [dimName, level] = String(p?.from || '').split('.');
    checkDimRef(path + '.from', { dim: dimName, level }, 'argumento');
  };

  (Array.isArray(plan.globalParams) ? plan.globalParams : []).forEach((p, i) => checkParam(`globalParams[${i}]`, p));
  if (plan.globalParams !== undefined && !Array.isArray(plan.globalParams)) err('globalParams', 'deve ser lista');
  if (plan.warnings !== undefined && (!Array.isArray(plan.warnings) || plan.warnings.some((w) => typeof w !== 'string')))
    err('warnings', 'deve ser lista de textos');

  if (!Array.isArray(plan.pages) || !plan.pages.length) {
    err('pages', 'ao menos uma página');
    return errors;
  }
  if (plan.pages.length > REPORT_LIMITS.pages) err('pages', `máximo ${REPORT_LIMITS.pages} páginas (anti-runaway)`);

  const paths = new Set();
  const ids = new Set();
  plan.pages.forEach((pg, pi) => {
    const pp = `pages[${pi}]`;
    if (!pg || typeof pg !== 'object') {
      err(pp, 'página deve ser objeto');
      return;
    }
    if (!PATH_RE.test(String(pg.path || ''))) err(pp + '.path', 'nome seguro terminando em .md (ex.: visao_geral.md ou [editor].md)');
    else if (paths.has(pg.path)) err(pp + '.path', `caminho duplicado: ${pg.path}`);
    paths.add(pg.path);
    if (!pg.title || typeof pg.title !== 'string') err(pp + '.title', 'obrigatório');
    if (pg.prose !== undefined && typeof pg.prose !== 'string') err(pp + '.prose', 'markdown autoral (texto)'); // F6 D33

    // D29/F5.1: [nome].md ↔ parameter.name TÊM que casar — o runtime lê
    // params.<nome do arquivo>; divergência geraria página quebrada.
    const mParam = String(pg.path || '').match(/^\[([a-z_][a-z0-9_]*)\]\.md$/i);
    if (mParam && pg.parameter === undefined)
      err(pp + '.parameter', `página ${pg.path} exige parameter {name: "${mParam[1]}", dimension: <dim do modelo>}`);
    if (pg.parameter !== undefined) {
      if (!pg.parameter || !IDENT.test(String(pg.parameter.name || ''))) err(pp + '.parameter.name', 'identificador obrigatório');
      checkDimRef(pp + '.parameter', { dim: pg.parameter?.dimension }, 'página parametrizada');
      if (!mParam) err(pp + '.path', 'página parametrizada deve chamar [nome].md');
      else if (pg.parameter?.name && mParam[1] !== pg.parameter.name)
        err(pp + '.path', `o arquivo [${mParam[1]}].md deve casar com parameter.name "${pg.parameter.name}" — o runtime lê params.${mParam[1]}`);
    }

    const blocks = Array.isArray(pg.blocks) ? pg.blocks : null;
    if (!blocks || !blocks.length) {
      err(pp + '.blocks', 'ao menos um bloco');
      return;
    }
    if (blocks.length > REPORT_LIMITS.blocksPerPage) err(pp + '.blocks', `máximo ${REPORT_LIMITS.blocksPerPage} blocos por página (anti-runaway)`);

    blocks.forEach((b, bi) => {
      const bp = `${pp}.blocks[${bi}]`;
      if (!b || typeof b !== 'object') {
        err(bp, 'bloco deve ser objeto');
        return;
      }
      if (b.id !== undefined) {
        // F6: ids absorvidos de páginas podem vir de hash (vb_117591 → 117591)
        if (!/^[a-z0-9_]+$/i.test(String(b.id))) err(bp + '.id', 'identificador inválido');
        else if (ids.has(b.id)) err(bp + '.id', `id duplicado: ${b.id}`);
        ids.add(b.id);
      }
      let refsOk = true;
      const metrics = Array.isArray(b.metrics) ? b.metrics : [];
      if (!Array.isArray(b.metrics)) err(bp + '.metrics', 'deve ser lista de nomes de métricas');
      metrics.forEach((m, mi) => {
        if (!mets[m]) {
          err(`${bp}.metrics[${mi}]`, `métrica "${m}" não existe no modelo ${catalog.model}`);
          refsOk = false;
        }
      });
      const bdims = Array.isArray(b.dims) ? b.dims : [];
      if (b.dims !== undefined && !Array.isArray(b.dims)) err(bp + '.dims', 'deve ser lista de {dim, level?}');
      bdims.forEach((d, di) => {
        if (!checkDimRef(`${bp}.dims[${di}]`, d, 'dimensão')) refsOk = false;
      });
      (Array.isArray(b.filters) ? b.filters : []).forEach((f, fi) => {
        const fp = `${bp}.filters[${fi}]`;
        if (!checkDimRef(fp, f, 'filtro')) refsOk = false;
        if (!Array.isArray(f?.values) || !f.values.length) err(fp + '.values', 'lista não-vazia de valores');
      });
      if (b.filters !== undefined && !Array.isArray(b.filters)) err(bp + '.filters', 'deve ser lista de {dim, level?, values[]}');

      const style = styleById(String(b.style || ''));
      if (!style) {
        err(bp + '.style', `estilo "${b.style}" não existe no registro`);
        return;
      }
      if (!refsOk) return; // sem referências válidas o requires() não tem o que checar
      // mesmo vbDraft do Wizard (shapes com alias — contrato dos estilos igual)
      const vbDraft = {
        dims: bdims.map((s) => ({ dim: s.dim, level: s.level, alias: dimAliasOf(catalog, s), column: dimAliasOf(catalog, s), table: catalog.fact })),
        metrics: metrics.map((n) => ({ name: n, alias: n, column: n, label: mets[n]?.label })),
        params: plan.globalParams || [],
        roles: b.roles,
        pivot: b.pivot,
        nested: b.nested,
        source: { kind: 'semantic', name: catalog.model },
      };
      try {
        const r = style.requires(vbDraft, source);
        if (!r.ok) err(bp + '.style', `seleção não atende "${style.label}": ${r.reason || 'contrato não atendido'}`);
      } catch (e) {
        err(bp + '.style', `estilo "${b.style}": ${e.message}`);
      }
    });
  });

  return errors;
}
