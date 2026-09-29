// Agente de RELATÓRIO COMPLETO (F5, M29): o usuário descreve em português, a
// IA propõe um ReportPlan (intenções + referências semânticas — SEM SQL/MD),
// o servidor valida contra o catálogo REAL (D22: nunca aceito do browser) e o
// compilador determinístico gera as páginas (report-apply, M30).
import { Router } from 'express';
import { loadCatalogs, factColumnsFor } from '../semantic.js';
import { validateReportPlan, REPORT_LIMITS } from '../../shared/reportPlan.js';
import {
  STYLES,
  styleMenuLines,
  isUfColumn,
  REFERENCE_STYLES,
  REFERENCE_FROM_STYLES,
  ORDER_IGNORED_STYLES,
  ORIENTATION_STYLES,
  TABLE_STYLES,
} from '../../shared/viewStyles.js';
import { internalDims } from '../../shared/semanticCatalog.js';
import { applyReport } from '../reportApply.js';
import { callAgent } from './ai.js';

const router = Router({ mergeParams: true });

// JSON Schema da resposta do modelo — espelha o contrato ReportPlan v1.
// additionalProperties: false em tudo: o modelo não tem onde esconder SQL.
const DIM_REF = {
  type: 'object',
  properties: { dim: { type: 'string' }, level: { type: 'string' } },
  required: ['dim'],
  additionalProperties: false,
};
const FILTER = {
  type: 'object',
  properties: { dim: { type: 'string' }, level: { type: 'string' }, values: { type: 'array', items: { type: ['string', 'number'] } } },
  required: ['dim', 'values'],
  additionalProperties: false,
};
// Teto do AGENTE, mais apertado que o do contrato (REPORT_LIMITS, 8×8, que vale
// para o plano montado à mão). Vai no schema como maxItems, que o servidor local
// aplica como GRAMÁTICA: o qwen3-14b ignorava o limite escrito no prompt e
// empilhava um bloco por métrica até estourar os 4096 tokens (medido 28/09/2026).
export const AGENT_LIMITS = { pages: 4, blocksPerPage: 4 };

/**
 * Pedido que quer UMA PÁGINA POR VALOR ("uma página para cada região", "dossiê
 * de cada IES")? Só nesse caso o schema do agente oferece `parameter`. Sem o
 * campo, o modelo não consegue inventar página parametrizada — antes ele punha
 * parameter em todo "X por Y" (que é agrupamento) e o plano voltava inválido.
 * Na dúvida, NÃO: página comum sempre funciona.
 */
export function wantsPagePerValue(pedido) {
  return /\b(cada|dossi[êe]s?|individual(mente)?)\b|\buma\s+p[áa]gina\s+(por|para)\b|\bp[áa]ginas?\s+por\s+(valor|item)\b/i.test(String(pedido || ''));
}

/**
 * Referências a dimensão como GRAMÁTICA: uma variante por dimensão com
 * hierarquia (só os níveis DELA) e uma para as planas (sem `level`). Onde o
 * validador exige o nível (filtro, parâmetro), a variante o torna obrigatório —
 * exceto quando a própria coluna é um nível (o SQL sai igual sem ele).
 * `chave` é o nome do campo da dimensão ('dim', ou 'dimension' no parameter).
 */
function dimRefSchema(dimsOk, { exigeNivel = false, chave = 'dim', extra = {}, extraRequired = [] } = {}) {
  const hier = (d) => d.hierarchy || [];
  const variantes = [];
  const planas = dimsOk.filter(([, d]) => !hier(d).length).map(([n]) => n);
  if (planas.length)
    variantes.push({ type: 'object', properties: { [chave]: { enum: planas }, ...extra }, required: [chave, ...extraRequired], additionalProperties: false });
  for (const [n, d] of dimsOk.filter(([, d]) => hier(d).length)) {
    const nivelObrigatorio = exigeNivel && !hier(d).includes(d.column);
    variantes.push({
      type: 'object',
      properties: { [chave]: { const: n }, level: { enum: hier(d) }, ...extra },
      required: [chave, ...(nivelObrigatorio ? ['level'] : []), ...extraRequired],
      additionalProperties: false,
    });
  }
  return variantes.length === 1 ? variantes[0] : { anyOf: variantes };
}

/**
 * Schema do AGENTE: o contrato ReportPlan apertado em gramática. O servidor
 * local (LM Studio/llama.cpp) aplica o schema como gramática — o modelo fica
 * incapaz de gerar o que ele não permite. Com `catalog`:
 *   - métricas, dimensões e níveis são LISTA FECHADA do catálogo (o qwen3-30b
 *     escrevia `{dim: "tempo.ano"}`; o Gemma 4, argumento em `tempo` sem nível);
 *   - em relatório público, dimensões internas/pii nem aparecem;
 *   - `reference` só existe nos estilos que desenham linha (REFERENCE_STYLES) —
 *     o 30b punha referência num mapa.
 * O validador continua sendo a autoridade; isto só tira do alcance do modelo o
 * que ele recusaria.
 */
export function planSchema({ allowParameter = true, allowReference = true, catalog = null, visibility = 'public' } = {}) {
  const s = JSON.parse(JSON.stringify(REPORT_PLAN_SCHEMA));
  s.properties.pages.minItems = 1;
  s.properties.pages.maxItems = AGENT_LIMITS.pages;
  const page = s.properties.pages.items;
  // O nome do arquivo também vira gramática: o modelo escrevia `regioes/[regiao].md`
  // (pasta), que o contrato não aceita. Mesmo formato do PATH_RE de reportPlan.js.
  page.properties.path.pattern = allowParameter ? '^([a-z0-9_]+|\\[[a-z_][a-z0-9_]*\\])\\.md$' : '^[a-z0-9_]+\\.md$';
  page.properties.blocks.minItems = 1;
  page.properties.blocks.maxItems = AGENT_LIMITS.blocksPerPage;
  if (!allowParameter) delete page.properties.parameter;
  const block = page.properties.blocks.items;
  block.properties.style = { enum: PLANNABLE };

  if (catalog) {
    const internas = visibility === 'internal' ? new Set() : internalDims(catalog);
    const dimsOk = Object.entries(catalog.dimensions || {}).filter(([n]) => !internas.has(n));
    const metricas = Object.keys(catalog.metrics || {});
    if (metricas.length) block.properties.metrics.items = { enum: metricas };
    if (dimsOk.length) {
      block.properties.dims.items = dimRefSchema(dimsOk);
      block.properties.filters.items = dimRefSchema(dimsOk, {
        exigeNivel: true,
        extra: { values: FILTER.properties.values },
        extraRequired: ['values'],
      });
      if (page.properties.parameter)
        page.properties.parameter = dimRefSchema(dimsOk, { exigeNivel: true, chave: 'dimension', extra: { name: { type: 'string' } }, extraRequired: ['name'] });
      // Argumento: "from" é texto "dim" ou "dim.nivel" — as formas válidas, uma a uma.
      const froms = dimsOk.flatMap(([n, d]) => {
        const h = d.hierarchy || [];
        if (!h.length) return [n];
        return [...(h.includes(d.column) ? [n] : []), ...h.map((l) => `${n}.${l}`)];
      });
      s.properties.globalParams.items.properties.from = { enum: froms };
      const nomes = [...metricas, ...dimsOk.map(([n]) => n)];
      block.properties.order.items.properties.by = { enum: nomes };
    }
  }

  // Cada estilo só com as opções que valem para ele (as mesmas listas fechadas
  // do validador): o qwen3-30b punha `table` num mapa e `reference` onde não há
  // linha. Estilos com o mesmo conjunto de opções dividem uma variante.
  const variantes = new Map();
  for (const id of PLANNABLE) {
    const ok = opcoesDoEstilo(id, { allowReference });
    const chave = JSON.stringify(ok);
    if (!variantes.has(chave)) variantes.set(chave, { ok, ids: [] });
    variantes.get(chave).ids.push(id);
  }
  page.properties.blocks.items = {
    anyOf: [...variantes.values()].map(({ ok, ids }) => {
      const v = JSON.parse(JSON.stringify(block));
      v.properties.style = { enum: ids };
      for (const [opcao, vale] of Object.entries(ok)) if (!vale) delete v.properties[opcao];
      // `from` (ler o valor de uma métrica) só onde o corpo tira a métrica das séries.
      if (v.properties.reference && ok.referenceFrom === false) delete v.properties.reference.items.properties.from;
      return v;
    }),
  };
  return s;
}

/**
 * Opções de bloco válidas por estilo — espelho das listas do validador
 * (viewStyles.js). `reference` ainda depende do pedido: o prompt manda nunca
 * inventar linha, e o modelo inventava; sem pedido de meta/média/limite, nem existe.
 */
function opcoesDoEstilo(id, { allowReference }) {
  return {
    order: !ORDER_IGNORED_STYLES.includes(id),
    orientation: ORIENTATION_STYLES.includes(id),
    reference: allowReference && REFERENCE_STYLES.includes(id),
    referenceFrom: REFERENCE_FROM_STYLES.includes(id),
    stack: id === 'group',
    table: TABLE_STYLES.includes(id),
    nested: id === 'nested',
    distribution: id === 'graph.histogram',
    bump: id === 'graph.bump',
  };
}

/**
 * O pedido fala de algo que vira linha de referência (meta, média, limite,
 * período marcado…)? Só então o schema oferece `reference`.
 */
export function wantsReference(pedido) {
  return /\b(metas?|refer[êe]ncias?|linhas? de|m[ée]dias? (mundial|nacional|geral)|medianas?|limites?|limiar(es)?|tetos?|pisos?|patamar(es)?|alvos?|benchmarks?|per[íi]odo marcado|marcar o per[íi]odo)\b/i.test(String(pedido || ''));
}

export const REPORT_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    version: { const: 1 },
    title: { type: 'string' },
    purpose: { type: 'string' },
    audience: { type: 'string' },
    visibility: { enum: ['public', 'internal'] },
    catalog: { type: 'string' },
    globalParams: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { enum: ['enum', 'text', 'number', 'date'] },
          from: { type: 'string' },
          default: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['name', 'type', 'from'],
        additionalProperties: false,
      },
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string' },
          purpose: { type: 'string' },
          parameter: {
            type: 'object',
            properties: { name: { type: 'string' }, dimension: { type: 'string' }, level: { type: 'string' } },
            required: ['name', 'dimension'],
            additionalProperties: false,
          },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                metrics: { type: 'array', items: { type: 'string' } },
                dims: { type: 'array', items: DIM_REF },
                filters: { type: 'array', items: FILTER },
                style: { type: 'string' },
                explanation: { type: 'string' },
                // Config do estilo `nested` (pequenos múltiplos). Sem isto no
                // schema o modelo poderia NOMEAR o estilo mas não configurá-lo,
                // e todo bloco desses seria recusado na validação.
                nested: {
                  type: 'object',
                  properties: {
                    parent: { type: 'array', items: { type: 'string' } },
                    child: { type: 'array', items: { type: 'string' } },
                    childStyle: { enum: ['tabular', 'graph.bar', 'graph.line'] },
                    limitPerGroup: { type: 'integer' },
                    maxGroups: { type: 'integer' },
                  },
                  required: ['parent', 'child', 'childStyle'],
                  additionalProperties: false,
                },
                // Config do estilo `graph.histogram`. O nº de faixas é do
                // BLOCO, não do catálogo: é a escolha feita junto da pergunta.
                distribution: {
                  type: 'object',
                  properties: { bins: { type: 'integer' } },
                  required: ['bins'],
                  additionalProperties: false,
                },
                // Config do estilo `graph.bump`: quantas posições do topo
                // mostrar. Sem corte, um bump de centenas de entidades é um
                // novelo ilegível.
                bump: {
                  type: 'object',
                  properties: { top: { type: 'integer' } },
                  additionalProperties: false,
                },
                // OPÇÕES QUE ATRAVESSAM ESTILOS (BLOCK_OPTIONS em viewStyles.js).
                // O prompt as ensina e o validador as aceita — mas sem elas aqui,
                // com additionalProperties: false, o modelo era estruturalmente
                // incapaz de emiti-las. O prompt mandava usar o que o schema
                // proibia; a validação de cada uma continua em reportPlan.js.
                order: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { by: { type: 'string' }, dir: { enum: ['asc', 'desc'] } },
                    required: ['by'],
                    additionalProperties: false,
                  },
                },
                orientation: { enum: ['horizontal'] },
                stack: { enum: ['total', 'percent'] },
                table: {
                  type: 'object',
                  properties: { search: { type: 'boolean' }, rows: { type: 'integer' } },
                  additionalProperties: false,
                },
                // `value`/`from` aceitam escalar (linha) ou par (faixa) — ver
                // refsOf em chartOption.js. O schema não distingue os dois: o
                // erro educativo é do validador, que diz por que recusou.
                reference: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: {},
                      from: {},
                      axis: { enum: ['x', 'y'] },
                      label: { type: 'string' },
                    },
                    additionalProperties: false,
                  },
                },
              },
              required: ['metrics', 'dims', 'filters', 'style'],
              additionalProperties: false,
            },
          },
        },
        required: ['path', 'title', 'blocks'],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['version', 'title', 'purpose', 'visibility', 'catalog', 'globalParams', 'pages', 'warnings'],
  additionalProperties: false,
};

// Estilos que a IA pode propor. O critério é um só: o agente consegue preencher
// o contrato do estilo SÓ com nomes do catálogo?
//
// Ficam de FORA, cada um por um motivo diferente:
//   pivot        — `frozenCols` congela VALORES reais da dimensão-coluna; o
//                  agente não vê dados, então chutaria o domínio.
//   connectionmap/collabgraph — mapeiam PAPÉIS para colunas cruas da fonte
//                  (lat/lon, origem/destino, nós/arestas), que não existem no
//                  vocabulário do catálogo. Seguem no wizard manual.
export const PLANNABLE = ['tabular', 'graph.bar', 'graph.line', 'graph.bubble', 'graph.range', 'graph.histogram', 'graph.bump', 'group', 'freeform', 'areamap', 'pointmap', 'graph.treemap', 'graph.sankey', 'nested'];

/** Resumo do catálogo p/ o prompt (labels + grounding F4 + hierarquias). */
export function catalogSummary(catalog) {
  const enrich = (n, x, extra = {}) => ({
    label: x.label || n,
    ...(x.description ? { descrição: x.description } : {}),
    ...(Array.isArray(x.synonyms) && x.synonyms.length ? { sinônimos: x.synonyms } : {}),
    ...extra,
  });
  return {
    model: catalog.model,
    label: catalog.label,
    ...(catalog.description ? { descrição: catalog.description } : {}),
    metrics: Object.fromEntries(Object.entries(catalog.metrics || {}).map(([n, m]) => [n, enrich(n, m)])),
    dimensions: Object.fromEntries(
      Object.entries(catalog.dimensions || {}).map(([n, d]) => [
        n,
        enrich(n, d, {
          ...(d.hierarchy ? { níveis: d.hierarchy } : {}),
          ...(d.pii ? { pii: true } : {}),
          // Só estas servem aos mapas por UF (areamap/pointmap) — mesmo critério
          // do validador. Sem a marca o agente mandava `regiao` para o mapa.
          ...(isUfColumn(d.column) ? { mapa_uf: true } : {}),
        }),
      ])
    ),
    ...(catalog.hierarchies ? { hierarquias: catalog.hierarchies } : {}),
  };
}

export function planSystemPrompt(catalog, { audience, visibility, allowParameter = true } = {}) {
  const paginas = allowParameter
    ? [
        '- "X por Y" (ex.: "citações por região") é AGRUPAMENTO: Y vai em dims do bloco, numa página comum.',
        '  Página parametrizada (parameter) SÓ quando o pedido quer UMA PÁGINA POR VALOR ("uma página para cada',
        '  região", "dossiê de cada IES"). Na dúvida, não use parameter.',
        '- paths: minúsculas_com_underscore.md, SEM pasta; página parametrizada usa [nome].md (ex.: "[regiao].md",',
        '  nunca "regioes/[regiao].md") + parameter {name, dimension}.',
        '  Se a dimensão da página tiver níveis, acrescente parameter.level (ex.: uma página por ano →',
        '  {name: "ano", dimension: "tempo", level: "ano"}); sem o nível a rota compararia a coluna crua.',
        '- Na página de UM valor (parameter por Y), os blocos detalham esse valor por OUTRAS dimensões',
        '  (ex.: por UF, por ano); agrupar pela própria Y daria uma linha só.',
      ]
    : [
        '- "X por Y" (ex.: "citações por região") é AGRUPAMENTO: Y vai em dims do bloco. Todas as páginas são',
        '  comuns (este pedido não pede uma página por valor).',
        '- paths: minúsculas_com_underscore.md.',
      ];
  return [
    'Você planeja um RELATÓRIO de dados multipágina a partir de um pedido em pt-BR.',
    'Você NÃO escreve SQL nem Markdown — apenas um PLANO com nomes do catálogo semântico abaixo.',
    'Regras:',
    '- metrics/dims/filters: SOMENTE nomes do catálogo. Nunca invente.',
    '- "level" SÓ quando a dimensão declarar "níveis" no catálogo, e o valor tem de ser UM desses níveis',
    '  (ex.: {dim: tempo, level: mes}). Dimensão SEM níveis vai sozinha: {dim: regiao} — nunca {dim: regiao, level: regiao}.',
    '- filters: apenas valores EXPLÍCITOS no pedido (ex.: "em 2024" → {dim: tempo, level: ano, values: [2024]}).',
    '- style de cada bloco: um dos ids listados abaixo.',
    ...styleMenuLines(PLANNABLE),
    `- Máximo ${AGENT_LIMITS.pages} páginas e ${AGENT_LIMITS.blocksPerPage} blocos por página. Prefira 2–3 páginas enxutas;`,
    '  um bloco pode ter VÁRIAS métricas — não crie um bloco por métrica.',
    '- Mapas (areamap, pointmap): SÓ com a dimensão marcada mapa_uf no catálogo. Região, município, país',
    '  e qualquer outra dimensão geográfica sem essa marca vão em graph.bar ou tabular.',
    ...paginas,
    '- globalParams: filtros INTERATIVOS que o leitor muda (ex.: ano). Use type enum e default "%".',
    '  "from" leva o NOME REAL da dimensão do catálogo — com nível se ela tiver (ex.: from: "tempo.ano"),',
    '  ou só a dimensão se não tiver (ex.: from: "unidade"). NÃO escreva "dim.nivel" literalmente.',
    '- dimensões marcadas pii: NUNCA em relatório public.',
    '- "warnings": liste ambiguidades do pedido que você resolveu por conta própria ("" nenhum).',
    audience ? `- Público-alvo declarado: ${audience}.` : '',
    `- visibility do plano: ${visibility || 'public'}.`,
    '',
    'CATÁLOGO:',
    JSON.stringify(catalogSummary(catalog)),
  ]
    .filter(Boolean)
    .join('\n');
}

router.post('/report-plan', async (req, res) => {
  try {
    const project = req.params.project;
    const { request, catalog: modelName, audience, visibility = 'public' } = req.body || {};
    if (!request || !String(request).trim()) return res.status(400).json({ error: 'descreva o relatório (request)' });

    const validos = loadCatalogs(project).filter((m) => m.valid);
    if (!validos.length)
      return res.status(400).json({ error: 'o projeto não tem modelo semântico válido — crie um na aba Dados › Semântica (✨ Gerar rascunho ajuda)' });
    let entry = modelName ? validos.find((m) => m.model === modelName) : validos.length === 1 ? validos[0] : null;
    if (!entry && modelName) return res.status(400).json({ error: `modelo "${modelName}" não encontrado ou inválido` });
    if (!entry) return res.json({ choose: validos.map((m) => ({ model: m.model, label: m.label })) });

    const factColumns = await factColumnsFor(project, entry.catalog.fact);
    const allowParameter = wantsPagePerValue(request);
    const system = planSystemPrompt(entry.catalog, { audience, visibility, allowParameter });
    const user = `Pedido: ${request}\nGere o ReportPlan (catalog: "${entry.model}", visibility: "${visibility}").`;
    const schema = planSchema({ allowParameter, allowReference: wantsReference(request), catalog: entry.catalog, visibility });

    let plan = await callAgent({ system, user, schema, schemaName: 'report_plan', maxTokens: 4096 });
    plan.catalog = entry.model; // o servidor é a autoridade (D22)
    plan.visibility = visibility;
    let errors = validateReportPlan(plan, { catalog: entry.catalog, factColumns });
    if (errors.length) {
      // 1 retry automático com os erros — depois disso o plano volta PARA
      // REVISÃO com os erros (nunca consertado em silêncio).
      const correcao =
        user +
        '\n\nSua proposta anterior tinha ERROS de validação — corrija-os mantendo o resto:\n' +
        errors.map((e) => `- ${e.path}: ${e.message}`).join('\n') +
        '\n\nProposta anterior:\n' +
        JSON.stringify(plan);
      plan = await callAgent({ system, user: correcao, schema, schemaName: 'report_plan', maxTokens: 4096 });
      plan.catalog = entry.model;
      plan.visibility = visibility;
      errors = validateReportPlan(plan, { catalog: entry.catalog, factColumns });
    }
    res.json({ plan, errors, model: entry.model, hash: entry.hash });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ---- Aplicação (F5.1, D30/D31): pipeline em server/reportApply.js ---------
// Duas fases .tmp→rename com rollback de melhor esforço na promoção.
router.post('/report-apply', async (req, res) => {
  try {
    const { plan, overwrite = [], saveSpec } = req.body || {};
    // F6 (revisão, achado 2): a spec é COMPOSTA ANTES e entra no MESMO staging
    // de duas fases das páginas — promovida PRIMEIRO. Nunca existe página
    // materializada sem a sua fonte de verdade.
    let specPrep = null;
    if (saveSpec) {
      const { getReport, reportsDir } = await import('../reports.js');
      const { stringify } = await import('yaml');
      const path = await import('node:path');
      let slug =
        String(plan?.title || 'relatorio')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9_-]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 40) || 'relatorio';
      let n = 2;
      const base = slug;
      while (getReport(req.params.project, slug)) slug = `${base}_${n++}`; // nunca sobrescreve spec alheia
      const spec = { name: slug, ...plan };
      const md =
        `# ${plan?.title || slug}\n\n${plan?.purpose || ''}\n\n` +
        `Gerado pelo agente ✨ (spec-driven). Edite a narrativa livremente — o contrato do\n` +
        `relatório vive no bloco \`studio-report\` abaixo; o build recompila as páginas a partir dele.\n\n` +
        '```studio-report\n' + stringify(spec).replace(/\n$/, '') + '\n```\n';
      specPrep = { slug, abs: path.join(reportsDir(req.params.project), slug + '.md'), content: md };
    }
    const r = await applyReport(req.params.project, plan, overwrite, {
      alsoWrite: specPrep ? [{ abs: specPrep.abs, content: specPrep.content }] : [],
    });
    if (r.errors) return res.status(400).json(r);
    if (r.error) return res.status(400).json(r);
    if (r.written && specPrep) {
      const { recordBuild } = await import('../reports.js');
      recordBuild(req.params.project, specPrep.slug, r.written); // páginas recém-geradas = build da spec
      r.spec = specPrep.slug;
    }
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
