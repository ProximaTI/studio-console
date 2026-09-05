import { describe, it, expect } from 'vitest';
import { mergeWithDefaults, DEFAULTS } from '../server/settings.js';

describe('mergeWithDefaults (settings do servidor)', () => {
  it('vazio/ausente retorna os defaults completos', () => {
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULTS);
    expect(mergeWithDefaults({})).toEqual(DEFAULTS);
  });

  it('settings antigos ganham blocos novos (ai, deploy) sem perder o que têm', () => {
    const antigo = { organization: { name: 'Proxima TI' }, theme: { mode: 'dark' } };
    const out = mergeWithDefaults(antigo);
    expect(out.organization.name).toBe('Proxima TI');
    expect(out.organization.decimalSeparator).toBe(','); // completado do default
    expect(out.theme.mode).toBe('dark');
    expect(out.ai.provider).toBe('openai'); // bloco novo injetado
    expect(out.deploy.dir).toBe('published');
  });

  it('valores do usuário têm precedência dentro de cada bloco', () => {
    const out = mergeWithDefaults({ ai: { provider: 'anthropic', apiKey: 'sk-x' }, deploy: { dir: 'D:/evidence' } });
    expect(out.ai.provider).toBe('anthropic');
    expect(out.ai.apiKey).toBe('sk-x');
    expect(out.ai.baseUrl).toBe(DEFAULTS.ai.baseUrl); // não sobrescrito -> default
    expect(out.deploy.dir).toBe('D:/evidence');
  });

  it('arrays (chartPalette) não são mesclados item a item — substituição inteira', () => {
    const out = mergeWithDefaults({ theme: { chartPalette: ['#000'] } });
    expect(out.theme.chartPalette).toEqual(['#000']);
  });

  it('não muta os DEFAULTS', () => {
    const before = JSON.stringify(DEFAULTS);
    mergeWithDefaults({ theme: { mode: 'dark' }, ai: { provider: 'anthropic' } });
    expect(JSON.stringify(DEFAULTS)).toBe(before);
  });
});
