// "Não pensar" no servidor local: o LM Studio mapeia reasoning_effort para o que
// o modelo aceita, e o qwen3 só aceita on/off — 'low' caía em 'on' (o log dizia
// "Falling back to reasoning setting 'on'"). Medido no qwen3-14b: 'none' → 0
// tokens de raciocínio; 'low' → 256.
import { describe, it, expect } from 'vitest';
import { noThinkParams } from '../server/routes/ai.js';

describe('noThinkParams', () => {
  it('desligado: não envia nada', () => {
    expect(noThinkParams({ noThink: false })).toEqual({});
  });

  it("ligado: reasoning_effort 'none' (nunca 'low') e enable_thinking false", () => {
    const p = noThinkParams({ noThink: true });
    expect(p.reasoning_effort).toBe('none');
    expect(p.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});
