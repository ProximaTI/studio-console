// ReportPlan v1 (F5, D21): contrato do relatório PLANEJADO pela IA — só
// intenções e referências semânticas (nomes do catálogo, filtros {dim, level?,
// values[]}, estilos por id do registro). SEM SQL, SEM Markdown: quem gera é o
// compilador determinístico. Plano inválido volta com erros para revisão —
// nunca é "consertado" em silêncio.
import { internalDims, hierarchyOf } from './semanticCatalog.js';
import {
  styleById,
  TABLE_STYLES,
  ORDER_IGNORED_STYLES,
  REFERENCE_STYLES,
  REFERENCE_FROM_STYLES,
  ORIENTATION_STYLES,
} from './viewStyles.js';
import { dimAliasOf, isRankMetric, MIN_BINS, MAX_BINS } from './semanticCompile.js';

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

  // `exigeNivel`: onde o valor é COMPARADO (filtro, argumento). Dimensão com
  // hierarquia sem nível compara com a coluna CRUA — {dim: tempo, values:
  // ["2024"]} vira `"data" = '2024'`, que o banco recusa, e como argumento
  // vira um LIKE que nunca casa (errado em silêncio, que é pior). Onde há
  // hierarquia, o nível é obrigatório.
  const checkDimRef = (path, ref, uso, exigeNivel) => {
    if (!ref || !dims[ref.dim]) {
      err(path + '.dim', `dimensão "${ref?.dim}" não existe no modelo ${catalog.model}`);
      return false;
    }
    if (ref.level && !(dims[ref.dim].hierarchy || []).includes(ref.level)) {
      err(path + '.level', `nível "${ref.level}" não existe na hierarquia de "${ref.dim}"`);
      return false;
    }
    const hier = dims[ref.dim].hierarchy || [];
    // Quando a COLUNA da dimensão é ela mesma um nível (year com hierarchy
    // [year]), omitir o nível NÃO é ambíguo: o SQL sai byte-idêntico. A regra
    // existe contra ambiguidade, não contra a falta de cerimônia.
    const colunaEhNivel = hier.includes(dims[ref.dim].column);
    if (exigeNivel && !ref.level && hier.length && !colunaEhNivel) {
      err(
        path + '.level',
        `"${ref.dim}" tem níveis (${hier.join(', ')}) — diga qual em ${uso}: sem nível o valor é ` +
          `comparado com a coluna crua "${dims[ref.dim].column}", não com o nível`
      );
      return false;
    }
    if (publico && internas.has(ref.dim)) err(path + '.dim', `"${ref.dim}" é interna (pii/expose) — proibida em ${uso} de relatório PÚBLICO`);
    return true;
  };

  const checkParam = (path, p) => {
    if (!p || !IDENT.test(String(p.name || ''))) err(path + '.name', 'identificador obrigatório');
    if (!PARAM_TYPES.has(p?.type)) err(path + '.type', 'enum | text | number | date');
    const [dimName, level] = String(p?.from || '').split('.');
    checkDimRef(path + '.from', { dim: dimName, level }, 'argumento', true);
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
      err(pp + '.parameter', `página ${pg.path} exige parameter {name: "${mParam[1]}", dimension: <dim do modelo>, level?: <nível, se a dim tiver>}`);
    if (pg.parameter !== undefined) {
      if (!pg.parameter || !IDENT.test(String(pg.parameter.name || ''))) err(pp + '.parameter.name', 'identificador obrigatório');
      checkDimRef(pp + '.parameter', { dim: pg.parameter?.dimension, level: pg.parameter?.level }, 'parameter.level', true);
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
        if (!checkDimRef(fp, f, 'filtro', true)) refsOk = false;
        if (!Array.isArray(f?.values) || !f.values.length) err(fp + '.values', 'lista não-vazia de valores');
      });
      if (b.filters !== undefined && !Array.isArray(b.filters)) err(bp + '.filters', 'deve ser lista de {dim, level?, values[]}');

      const style = styleById(String(b.style || ''));
      if (!style) {
        err(bp + '.style', `estilo "${b.style}" não existe no registro`);
        return;
      }
      if (!refsOk) return; // sem referências válidas o requires() não tem o que checar
      // graph.histogram: o contrato do estilo só vê aridade. O que a MÉTRICA
      // é (ponteiro para uma coluna observável) só o catálogo sabe — e o erro
      // precisa aparecer na validação do plano, não só no build.
      if (b.style === 'graph.bump') {
        if (!isRankMetric(catalog, metrics[0]))
          err(bp + '.metrics[0]', `"${metrics[0]}" não é uma métrica de posição — declare no catálogo uma derivada posicao(<métrica>, <nível>)`);
        const topo = b.bump?.top;
        if (topo !== undefined && (!Number.isInteger(topo) || topo < 2))
          err(bp + '.bump.top', 'quantas posições mostrar: inteiro ≥ 2 (recorte "esteve no top N em algum período")');
      }
      if (b.style === 'graph.histogram') {
        const bins = b.distribution?.bins;
        if (!Number.isInteger(bins) || bins < MIN_BINS || bins > MAX_BINS)
          err(bp + '.distribution.bins', `número de faixas: inteiro entre ${MIN_BINS} e ${MAX_BINS}`);
        const m = mets[metrics[0]];
        if (m?.derived)
          err(bp + '.metrics[0]', `"${metrics[0]}" é derivada e não tem coluna — o histograma observa uma COLUNA do fato`);
        else if (m && (m.agg === 'count' || m.agg === 'count_distinct'))
          err(bp + '.metrics[0]', `"${metrics[0]}" conta ocorrências — aponte uma métrica sum/avg/min/max sobre a medida a observar`);
      }
      // `table`: configuração de LEITURA (busca, tamanho de página). Conjunto
      // FECHADO de chaves e restrito a quem desenha uma tabela — declarar busca
      // num gráfico não faria nada, e silêncio aqui viraria bug de leitura.
      if (b.table !== undefined) {
        const tp = bp + '.table';
        if (!b.table || typeof b.table !== 'object' || Array.isArray(b.table)) err(tp, 'objeto {search?: true, rows?: N}');
        else if (!TABLE_STYLES.includes(b.style))
          err(tp, `"table" configura a tabela e só vale em ${TABLE_STYLES.join(' | ')} — "${b.style}" não desenha uma`);
        else {
          for (const k of Object.keys(b.table)) if (k !== 'search' && k !== 'rows') err(tp + '.' + k, 'chave desconhecida — use search e/ou rows');
          if (b.table.search !== undefined && typeof b.table.search !== 'boolean') err(tp + '.search', 'true ou false');
          if (b.table.rows !== undefined && (!Number.isInteger(b.table.rows) || b.table.rows < 1))
            err(tp + '.rows', 'linhas por página: inteiro ≥ 1');
        }
      }
      // `order`: sem ela o SQL sai pela 1ª métrica desc. Só pode apontar para o
      // que ESTÁ na seleção do bloco — ordenar por coluna ausente seria SQL
      // inválido descoberto só na hora de rodar.
      if (b.order !== undefined) {
        const op = bp + '.order';
        if (!Array.isArray(b.order) || !b.order.length) err(op, 'lista não-vazia de {by, dir?}');
        else if (ORDER_IGNORED_STYLES.includes(b.style))
          err(op, `"${b.style}" define a própria ordem e ignoraria "order" — remova a chave`);
        else
          b.order.forEach((o, oi) => {
            const alvo = `${op}[${oi}]`;
            const naSelecao = metrics.includes(o?.by) || bdims.some((d) => d.dim === o?.by);
            if (!naSelecao) err(alvo + '.by', `"${o?.by}" não está na seleção do bloco — use uma métrica ou dimensão dele`);
            if (o?.dir !== undefined && !['asc', 'desc'].includes(String(o.dir))) err(alvo + '.dir', 'asc ou desc');
          });
      }
      // `reference`: linha de corte no gráfico. O valor é um literal (limiar que
      // é constante — 0, 1,0, 80%) ou vem de uma métrica do bloco (`from`), que
      // é como uma mediana entra no gráfico sem ninguém digitá-la.
      if (b.reference !== undefined) {
        const rp = bp + '.reference';
        if (!Array.isArray(b.reference) || !b.reference.length) err(rp, 'lista não-vazia de {value|from, axis?, label?}');
        else if (!REFERENCE_STYLES.includes(b.style))
          err(rp, `"${b.style}" não desenha linha de referência — vale em ${REFERENCE_STYLES.join(' | ')}`);
        else
          b.reference.forEach((r, ri) => {
            const alvo = `${rp}[${ri}]`;
            const temValor = r && r.value !== undefined;
            const temFrom = r && r.from !== undefined;
            if (temValor === temFrom) err(alvo, 'declare exatamente um: value (literal) ou from (métrica do bloco)');
            // ARRAY de dois = FAIXA (markArea); escalar = linha. Mesmas chaves:
            // `from` já quer dizer "ler de uma métrica", e reusá-la como início
            // do intervalo seria ambíguo.
            const faixaDe = (v) => (Array.isArray(v) ? v : null);
            if (temValor) {
              const par = faixaDe(r.value);
              if (par && (par.length !== 2 || par.some((v) => typeof v !== 'number')))
                err(alvo + '.value', 'faixa: exatamente dois números [início, fim]');
              else if (par && par[0] === par[1]) err(alvo + '.value', 'faixa com início igual ao fim não marca nada');
              else if (!par && typeof r.value !== 'number') err(alvo + '.value', 'número, ou [início, fim] para marcar uma faixa');
            }
            if (temFrom) {
              const par = faixaDe(r.from);
              const nomes = par || [r.from];
              if (par && par.length !== 2) err(alvo + '.from', 'faixa: exatamente duas métricas [início, fim]');
              for (const n of nomes) if (!metrics.includes(n)) err(alvo + '.from', `"${n}" não é métrica deste bloco`);
              if (!REFERENCE_FROM_STYLES.includes(b.style))
                err(
                  alvo + '.from',
                  `em "${b.style}" a posição da métrica na lista é o papel dela — use value (literal). ` +
                    `"from" vale em ${REFERENCE_FROM_STYLES.join(' | ')}`
                );
            }
            if (r?.axis !== undefined && !['x', 'y'].includes(String(r.axis))) err(alvo + '.axis', "x (categoria) ou y (valor)");
            if (r?.label !== undefined && typeof r.label !== 'string') err(alvo + '.label', 'texto');
          });
      }
      // `stack`: como a barra empilhada do `group` divide a coluna. Só existe
      // onde há pilha — e só no cruzamento que vira gráfico (2 dimensões, 1
      // métrica); nos demais o `group` é tabela e a chave não faria nada.
      if (b.stack !== undefined) {
        const sp = bp + '.stack';
        if (!['total', 'percent'].includes(String(b.stack))) err(sp, 'total (valor absoluto) ou percent (composição 100%)');
        else if (b.style !== 'group') err(sp, `"stack" empilha a barra do group — "${b.style}" não tem pilha`);
        else if (bdims.length !== 2 || metrics.length !== 1)
          err(sp, 'a pilha só existe no cruzamento de 2 dimensões com 1 métrica; fora disso o group é tabela');
      }
      // `orientation`: deita a marca. Só onde o eixo de categoria é o que sofre
      // com rótulo longo ou muita categoria — e só onde o motor monta o eixo
      // trocado, que é barra e histograma (ORIENTATION_STYLES).
      if (b.orientation !== undefined) {
        const op = bp + '.orientation';
        if (!['vertical', 'horizontal'].includes(String(b.orientation))) err(op, 'vertical (padrão) ou horizontal');
        else if (!ORIENTATION_STYLES.includes(b.style))
          err(op, `"${b.style}" não deita — "orientation" vale em ${ORIENTATION_STYLES.join(' | ')}`);
      }
      // mesmo vbDraft do Wizard (shapes com alias — contrato dos estilos igual)
      const vbDraft = {
        dims: bdims.map((s) => ({ dim: s.dim, level: s.level, alias: dimAliasOf(catalog, s), column: dimAliasOf(catalog, s), table: catalog.fact })),
        metrics: metrics.map((n) => ({ name: n, alias: n, column: n, label: mets[n]?.label })),
        params: plan.globalParams || [],
        roles: b.roles,
        pivot: b.pivot,
        nested: b.nested,
        distribution: b.distribution,
        bump: b.bump,
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
