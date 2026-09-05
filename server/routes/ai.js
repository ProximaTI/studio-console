// Agente da console — backend PLUGÁVEL de IA.
// Dois provedores:
//   - 'anthropic'        : Claude API (chave em settings.ai.apiKey ou env ANTHROPIC_API_KEY)
//   - 'openai' (local)   : qualquer endpoint OpenAI-compatível — LM Studio, vLLM, LiteLLM.
// A chave nunca vai ao browser; o SQL continua determinístico no cliente — a IA só
// escolhe seleções válidas (saída estruturada por JSON Schema).
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readSettings } from '../settings.js';

const router = Router();

// Resolve a config do agente: settings.ai (defaults já mesclados) + env.
function aiConfig() {
  const ai = readSettings().ai;
  const isAnthropic = ai.provider === 'anthropic';
  // Guarda: quem troca para Anthropic mas deixa o model default local não
  // manda "local-model" para a Claude API.
  const model =
    ai.model && !(isAnthropic && ai.model === 'local-model') ? ai.model : isAnthropic ? 'claude-opus-4-8' : 'local-model';
  return {
    provider: ai.provider,
    baseUrl: isAnthropic ? '' : String(ai.baseUrl || 'http://localhost:1234/v1').replace(/\/+$/, ''),
    model,
    apiKey: ai.apiKey || (isAnthropic ? process.env.ANTHROPIC_API_KEY || '' : ''),
    noThink: Boolean(ai.noThink),
  };
}

// Parâmetros para desligar o raciocínio em servidores OpenAI-compatíveis.
// Cada servidor/modelo respeita um: reasoning_effort (LM Studio/OpenAI-like),
// enable_thinking=false via chat_template_kwargs (vLLM + Qwen3). Quem não
// suporta simplesmente ignora campos desconhecidos.
function noThinkParams(cfg) {
  if (!cfg.noThink) return {};
  return { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false } };
}

// Local (OpenAI-compatível) só precisa de baseUrl; Anthropic precisa de chave.
function isEnabled(cfg) {
  return cfg.provider === 'anthropic' ? Boolean(cfg.apiKey) : Boolean(cfg.baseUrl);
}

// Extrai um objeto JSON do texto (tolerante a modelos locais que ignoram
// response_format e devolvem cercas markdown ou prosa em volta do JSON).
function parseJsonLoose(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Resposta do modelo não é JSON válido.');
  }
}

// Chamada unificada: recebe system/user + JSON Schema, devolve objeto validado pelo schema.
// Reutilizável por qualquer feature de IA (NL→SQL hoje; geração de relatório amanhã).
export async function callAgent({ system, user, schema, schemaName = 'output', maxTokens = 2048 }) {
  const cfg = aiConfig();
  if (!isEnabled(cfg)) {
    throw new Error(
      cfg.provider === 'anthropic'
        ? 'Agente Anthropic sem chave. Configure em Settings › Agente (ou ANTHROPIC_API_KEY).'
        : 'Agente local sem Base URL. Configure em Settings › Agente (ex.: http://localhost:1234/v1).'
    );
  }

  if (cfg.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: cfg.apiKey });
    try {
      const msg = await client.messages.create({
        model: cfg.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: String(user) }],
        output_config: { format: { type: 'json_schema', schema } },
      });
      const block = msg.content.find((b) => b.type === 'text');
      if (!block) throw new Error('Resposta vazia do modelo.');
      return parseJsonLoose(block.text);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Chave da Anthropic inválida.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Limite de requisições atingido — tente em instantes.');
      if (e instanceof Anthropic.APIError) throw new Error(`Erro da Anthropic (${e.status}): ${e.message}`);
      throw e;
    }
  }

  // OpenAI-compatível (LM Studio / vLLM / LiteLLM)
  const url = cfg.baseUrl + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const body = {
    model: cfg.model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(user) },
    ],
    // Saída estruturada (LM Studio/vLLM recentes honram; se ignorarem, cai no parseJsonLoose).
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
    ...noThinkParams(cfg),
  };
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Não foi possível conectar ao servidor local (${cfg.baseUrl}). O LM Studio/servidor está rodando?`);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Erro do servidor de IA (${r.status}): ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  return parseJsonLoose(content);
}

// Remove cercas markdown (```lang ... ```). Usa o ÚLTIMO bloco — modelos de
// raciocínio costumam repetir a resposta final por último.
function stripFences(s) {
  const all = [...String(s || '').matchAll(/```(?:\w+)?\s*([\s\S]*?)```/g)];
  if (all.length) return all[all.length - 1][1].trim();
  return String(s || '').trim();
}

// Chamada de IA que devolve TEXTO livre (para escrever sintaxe de célula).
// maxTokens generoso: modelos de raciocínio (gemma/qwen/deepseek) gastam tokens
// pensando e truncam a resposta se o teto for baixo.
export async function callAgentText({ system, user, maxTokens = 3072 }) {
  const cfg = aiConfig();
  if (!isEnabled(cfg)) {
    throw new Error('Agente não configurado. Ajuste em Settings › Agente (IA).');
  }
  if (cfg.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: cfg.apiKey });
    const msg = await client.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: String(user) }],
    });
    const block = msg.content.find((b) => b.type === 'text');
    return block ? block.text : '';
  }
  const url = cfg.baseUrl + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const body = {
    model: cfg.model,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(user) },
    ],
    ...noThinkParams(cfg),
  };
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error(`Não foi possível conectar ao servidor local (${cfg.baseUrl}).`);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Erro do servidor de IA (${r.status}): ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const m = data.choices?.[0]?.message || {};
  // Modelos de raciocínio: se truncar, o `content` vem vazio e a resposta fica no
  // `reasoning_content` — usamos como fallback (stripFences pega o bloco final).
  const out = m.content && String(m.content).trim() ? m.content : m.reasoning_content || '';
  return String(out || '');
}

// Instruções por tipo de célula do notebook.
function cellSystem(cellType, schema) {
  const ctx = schema ? '\n\nCONTEXTO (JSON — tabelas, queries e params disponíveis):\n' + JSON.stringify(schema) : '';
  if (cellType === 'sql') {
    return (
      [
        'Você escreve UMA consulta SQL para DuckDB a partir do pedido do usuário.',
        'Use SOMENTE tabelas e colunas existentes no contexto; use os nomes exatos.',
        'Responda APENAS com o SQL — sem cercas markdown, sem comentários, sem explicação.',
      ].join('\n') + ctx
    );
  }
  if (cellType === 'raw') {
    return (
      [
        'Você escreve UMA tag de componente do dialeto Evidence para um relatório.',
        'Componentes: <BigValue data={q} value=col fmt=num0/> · <BarChart data={q} x= y= title=/> · <LineChart .../> ·',
        '<DataTable data={q}> <Column id= title=/> </DataTable> · <Dropdown data={q} name= value= label=/>.',
        'data={nome} deve referenciar uma query existente (veja "queries" no contexto).',
        'Responda APENAS com a(s) tag(s) — sem cercas markdown, sem explicação.',
      ].join('\n') + ctx
    );
  }
  return (
    [
      'Você escreve markdown para uma página de relatório (dialeto Evidence).',
      'Pode usar interpolação inline: {query[0].coluna}, {query.length}, {params.x}.',
      'Responda APENAS com o markdown — sem cercas de código em volta, sem explicação.',
    ].join('\n') + ctx
  );
}

router.post('/cell', async (req, res) => {
  const { cellType, request, schema } = req.body || {};
  if (!request || !cellType) return res.status(400).json({ error: 'cellType e request são obrigatórios' });
  try {
    const raw = await callAgentText({ system: cellSystem(cellType, schema), user: request });
    let content = String(raw || '').trim();
    // SQL/Raw nunca devem vir cercados; texto só remove cerca se envolver tudo.
    if (cellType === 'sql' || cellType === 'raw') content = stripFences(content);
    else if (/^```[\s\S]*```$/.test(content)) content = stripFences(content);
    res.json({ content });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Schema das seleções do SQL Builder (NL → seleções).
const SELECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    groupBy: {
      type: 'array',
      items: {
        type: 'object',
        properties: { table: { type: 'string' }, column: { type: 'string' } },
        required: ['table', 'column'],
        additionalProperties: false,
      },
    },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string' },
          agg: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] },
        },
        required: ['column', 'agg'],
        additionalProperties: false,
      },
    },
    filters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          column: { type: 'string' },
          values: { type: 'array', items: { type: 'string' } },
        },
        required: ['table', 'column', 'values'],
        additionalProperties: false,
      },
    },
    note: { type: 'string' },
  },
  required: ['groupBy', 'measures', 'filters', 'note'],
  additionalProperties: false,
};

router.get('/status', (_req, res) => {
  const cfg = aiConfig();
  const enabled = isEnabled(cfg);
  res.json({
    enabled,
    provider: cfg.provider,
    model: enabled ? cfg.model : undefined,
    baseUrl: cfg.provider === 'anthropic' ? undefined : cfg.baseUrl,
  });
});

// Modo CATÁLOGO (F3 §2): sobre fonte semântica o espaço de escolha do agente é
// o catálogo — só NOMES de métricas/dimensões. SQL jamais transita: a proposta
// é validada no cliente contra o catálogo e cai no compilador determinístico.
const CATALOG_SELECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    metrics: { type: 'array', items: { type: 'string' } },
    dimensions: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
  required: ['metrics', 'dimensions', 'note'],
  additionalProperties: false,
};

router.post('/nl-query', async (req, res) => {
  const { text, schema, project, model } = req.body || {};
  // D22 (F5): o catálogo é resolvido AQUI por nome — o browser não dita o
  // conteúdo. Compat: `catalog` objeto ainda é aceito por 1 versão.
  let catalog = req.body?.catalog;
  if (project && model) {
    const { getCatalog } = await import('../semantic.js');
    const entry = getCatalog(project, model);
    if (!entry) return res.status(400).json({ error: `modelo "${model}" não encontrado ou inválido no projeto ${project}` });
    catalog = entry.catalog;
  }
  if (catalog) {
    if (!text) return res.status(400).json({ error: 'text é obrigatório' });
    // F4 frente E: description/synonyms do catálogo entram no resumo — é o que
    // faz "faturamento" resolver para valor_total sem retry.
    const enrich = (n, x, extra = {}) => ({
      label: x.label || n,
      ...(x.description ? { descrição: x.description } : {}),
      ...(Array.isArray(x.synonyms) && x.synonyms.length ? { sinônimos: x.synonyms } : {}),
      ...extra,
    });
    const resumo = {
      model: catalog.model,
      label: catalog.label,
      ...(catalog.description ? { descrição: catalog.description } : {}),
      metrics: Object.fromEntries(Object.entries(catalog.metrics || {}).map(([n, m]) => [n, enrich(n, m)])),
      dimensions: Object.fromEntries(
        Object.entries(catalog.dimensions || {}).map(([n, d]) => [n, enrich(n, d, d.hierarchy ? { níveis: d.hierarchy } : {})])
      ),
    };
    const system = [
      'Você mapeia um pedido em pt-BR para uma seleção de um CATÁLOGO SEMÂNTICO fechado.',
      'Regras:',
      '- metrics: SOMENTE nomes listados em "metrics" do catálogo. Nunca invente.',
      '- dimensions: SOMENTE nomes de "dimensions"; para dimensão com níveis use "nome.nivel" (ex.: tempo.ano).',
      '- Nada de SQL, colunas cruas, agregações ou filtros — só nomes do catálogo.',
      '- "note": frase curta em pt-BR sobre ambiguidades ou o que não foi possível mapear ("" se nada).',
      '',
      'CATÁLOGO:',
      JSON.stringify(resumo),
    ].join('\n');
    try {
      const out = await callAgent({ system, user: text, schema: CATALOG_SELECTIONS_SCHEMA, schemaName: 'catalog_selections' });
      return res.json(out);
    } catch (e) {
      return res.json({ error: e.message });
    }
  }
  if (!text || !schema) return res.status(400).json({ error: 'text e schema são obrigatórios' });

  const system = [
    'Você mapeia um pedido em linguagem natural para seleções de um construtor visual de SQL.',
    'O modelo de dados disponível (tabela-fato, medidas, dimensões e seus atributos) está no JSON abaixo.',
    'Regras:',
    '- Use SOMENTE tabelas e colunas listadas no modelo; nunca invente nomes.',
    '- "fact.attributes" pertencem à tabela-fato; atributos de dimensões pertencem à sua própria tabela.',
    '- measures: colunas de "fact.measures" com a agregação pedida (default sum; "média"->avg, "contagem/quantos"->count).',
    '- groupBy: atributos pedidos com "por X" ou implícitos na pergunta.',
    '- filters: apenas valores explicitamente citados no texto (anos viram filtro na coluna de ano da fato).',
    '- "note": uma frase curta em pt-BR explicando mapeamentos ambíguos ou o que não foi possível mapear ("" se nada a dizer).',
    '- Responda SOMENTE com o JSON no formato pedido.',
    '',
    'MODELO:',
    JSON.stringify(schema),
  ].join('\n');

  try {
    const out = await callAgent({ system, user: text, schema: SELECTIONS_SCHEMA, schemaName: 'selections' });
    res.json(out);
  } catch (e) {
    res.json({ error: e.message });
  }
});

export default router;
