// Fonte ÚNICA de leitura/escrita do settings.json (defaults + merge).
// Antes esta lógica estava quintuplicada (routes/settings, ai, projects×3),
// com defaults duplicados que já divergiram uma vez. Tudo passa por aqui.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SETTINGS_FILE = path.join(path.resolve(__dirname, '..'), 'settings.json');

export const DEFAULTS = {
  organization: { name: 'Meu Estúdio', decimalSeparator: ',' },
  theme: {
    mode: 'light',
    background: '#ecefe8',
    card: '#ffffff',
    primary: '#2c8a4a',
    chartPalette: ['#236aa4', '#45a1bf', '#a5cdee', '#7b61ff', '#16a34a', '#f59e0b', '#dc2626', '#0891b2'],
  },
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

export function writeSettings(s) {
  const merged = mergeWithDefaults(s);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}
