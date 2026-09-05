// Agente de RELATÓRIO COMPLETO (F5, M29): o usuário descreve em português, a
// IA propõe um ReportPlan (intenções + referências semânticas — SEM SQL/MD),
// o servidor valida contra o catálogo REAL (D22: nunca aceito do browser) e o
// compilador determinístico gera as páginas (report-apply, M30).
import { Router } from 'express';
import { loadCatalogs, factColumnsFor } from '../semantic.js';
import { validateReportPlan, REPORT_LIMITS } from '../../shared/reportPlan.js';
import { STYLES } from '../../shared/viewStyles.js';
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
            properties: { name: { type: 'string' }, dimension: { type: 'string' } },
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

// Estilos que a IA pode propor na v1 (papéis/pivot/nested exigem configuração
// que o plano ainda não transporta com segurança — ficam no wizard manual).
const PLANNABLE = ['tabular', 'graph.bar', 'graph.line', 'group', 'freeform', 'areamap'];

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
        enrich(n, d, { ...(d.hierarchy ? { níveis: d.hierarchy } : {}), ...(d.pii ? { pii: true } : {}) }),
      ])
    ),
    ...(catalog.hierarchies ? { hierarquias: catalog.hierarchies } : {}),
  };
}

export function planSystemPrompt(catalog, { audience, visibility } = {}) {
  const estilos = STYLES.filter((s) => PLANNABLE.includes(s.id)).map((s) => `${s.id} — ${s.label}`);
  return [
    'Você planeja um RELATÓRIO de dados multipágina a partir de um pedido em pt-BR.',
    'Você NÃO escreve SQL nem Markdown — apenas um PLANO com nomes do catálogo semântico abaixo.',
    'Regras:',
    '- metrics/dims/filters: SOMENTE nomes do catálogo. Nunca invente. Dimensão com níveis usa {dim, level}.',
    '- filters: apenas valores EXPLÍCITOS no pedido (ex.: "em 2024" → {dim: tempo, level: ano, values: [2024]}).',
    `- style de cada bloco: um de [${estilos.join(' · ')}]. KPIs/cards = freeform (só métricas). Mapa exige dimensão geográfica (uf).`,
    '- graph.bar exige exatamente 1 dimensão; graph.line exige 1 dimensão TEMPORAL; tabular ≥1 dim + ≥1 métrica; group ≥2 dims.',
    `- Máximo ${REPORT_LIMITS.pages} páginas e ${REPORT_LIMITS.blocksPerPage} blocos por página. Prefira 2–4 páginas enxutas.`,
    '- paths: minúsculas_com_underscore.md; página parametrizada usa [nome].md + parameter {name, dimension}.',
    '- globalParams: filtros INTERATIVOS que o leitor muda (ex.: ano) — use type enum com from "dim.nivel" e default "%".',
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
    const system = planSystemPrompt(entry.catalog, { audience, visibility });
    const user = `Pedido: ${request}\nGere o ReportPlan (catalog: "${entry.model}", visibility: "${visibility}").`;

    let plan = await callAgent({ system, user, schema: REPORT_PLAN_SCHEMA, schemaName: 'report_plan', maxTokens: 4096 });
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
      plan = await callAgent({ system, user: correcao, schema: REPORT_PLAN_SCHEMA, schemaName: 'report_plan', maxTokens: 4096 });
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
