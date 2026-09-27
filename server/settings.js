// Fonte ÚNICA de leitura/escrita do settings.json (defaults + merge).
// Antes esta lógica estava quintuplicada (routes/settings, ai, projects×3),
// com defaults duplicados que já divergiram uma vez. Tudo passa por aqui.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THEME } from '../shared/designTokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SETTINGS_FILE = path.join(path.resolve(__dirname, '..'), 'settings.json');

export const DEFAULTS = {
  organization: { name: 'Meu Estúdio', decimalSeparator: ',' },
  // Tema global = padrão da instalação. Os VALORES vivem em shared/designTokens.js;
  // um projeto pode sobrescrever os tokens de MARCA no seu project.yaml (`theme:`).
  theme: { ...DEFAULT_THEME },
  // Agente de IA (plugável): 'anthropic' ou 'openai' (LM Studio / vLLM / LiteLLM).
  // noThink: pede ao servidor local para desligar o raciocínio (reasoning) — economiza
  // tokens/latência em modelos tipo Qwen3/DeepSeek; servidores que não suportam ignoram.
  ai: { provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', apiKey: '', noThink: false },
  // Destino de deploy dos relatórios publicados (relativo à raiz da console ou absoluto).
  deploy: { dir: 'published' },
};

// Merge raso por bloco: settings antigos ganham os blocos novos sem perder nada.
export function mergeWithDefaults(saved) {
  const out = { ...DEFAULTS, ...(saved || {}) };
  for (const k of Object.keys(DEFAULTS)) {
    const d = DEFAULTS[k];
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      out[k] = { ...d, ...((saved || {})[k] || {}) };
    }
  }
  return out;
}

export function readSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    /* ausente ou inválido -> defaults */
  }
  return mergeWithDefaults(saved);
}

/**
 * Settings para a UI: a chave de API NUNCA sai do servidor. A UI recebe só
 * `hasApiKey` e manda a chave de volta apenas quando o usuário digita outra.
 */
export function publicSettings(s) {
  const ai = { ...(s.ai || {}) };
  ai.hasApiKey = Boolean(ai.apiKey);
  ai.apiKey = '';
  return { ...s, ai };
}

/**
 * Aplica o que a UI mandou sobre o que está gravado: apiKey vazia preserva a
 * atual; `clearApiKey: true` a remove. Os campos de controle não são gravados.
 */
export function mergeSettingsUpdate(incoming, current) {
  const inAi = { ...((incoming || {}).ai || {}) };
  const clear = inAi.clearApiKey === true;
  delete inAi.clearApiKey;
  delete inAi.hasApiKey;
  if (clear) inAi.apiKey = '';
  else if (!inAi.apiKey) inAi.apiKey = current?.ai?.apiKey || '';
  return { ...incoming, ai: inAi };
}

export function applySettingsUpdate(incoming) {
  return writeSettings(mergeSettingsUpdate(incoming, readSettings()));
}

export function writeSettings(s) {
  const merged = mergeWithDefaults(s);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}
