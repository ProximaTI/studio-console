import { describe, it, expect } from 'vitest';
import {
  BRAND_KEYS,
  DEFAULT_THEME,
  MIN_CONTRAST,
  PRESETS,
  PRESET_NAMES,
  chartPaletteOf,
  contrastRatio,
  resolveTheme,
  themeVars,
  validateTheme,
} from '../shared/designTokens.js';
import { publishCss } from '../server/publish/assets.js';

describe('resolveTheme — default → global → projeto', () => {
  it('o projeto sobrescreve o global, que sobrescreve o default', () => {
    const t = resolveTheme({ primary: '#111111', card: '#eeeeee' }, { primary: '#222222' });
    expect(t.primary).toBe('#222222'); // projeto vence
    expect(t.card).toBe('#eeeeee'); // herdado do global
    expect(t.mode).toBe(DEFAULT_THEME.mode); // herdado do default
  });

  it('ignora chaves fora do conjunto de marca (estrutural não entra por aqui)', () => {
    const t = resolveTheme({}, { primary: '#222222', radius: '99px', qualquer: 1 });
    expect(t.primary).toBe('#222222');
    expect(t.radius).toBeUndefined();
    expect(Object.keys(t).every((k) => BRAND_KEYS.includes(k))).toBe(true);
  });
});

describe('validateTheme — conjunto FECHADO + guardas', () => {
  it('tema válido não gera erro; ausente também não', () => {
    expect(validateTheme({ primary: '#2c8a4a', mode: 'dark' })).toEqual([]);
    expect(validateTheme(undefined)).toEqual([]);
  });

  it('token não-sobrescrevível é ERRO com caminho, não aviso', () => {
    const e = validateTheme({ radius: '4px' });
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe('theme.radius');
    expect(e[0].message).toMatch(/não é sobrescrevível/);
  });

  it('recusa cor malformada, modo inválido e paleta vazia', () => {
    expect(validateTheme({ primary: 'verde' })[0].path).toBe('theme.primary');
    expect(validateTheme({ mode: 'sepia' })[0].path).toBe('theme.mode');
    expect(validateTheme({ chartPalette: [] })[0].path).toBe('theme.chartPalette');
    expect(validateTheme({ chartPalette: ['#2c8a4a', 'azul'] })[0].path).toBe('theme.chartPalette[1]');
  });

  it('guarda de contraste: primário ilegível sobre o cartão é recusado', () => {
    const e = validateTheme({ primary: '#f7f7c0', card: '#ffffff' }); // amarelo pálido no branco
    expect(e).toHaveLength(1);
    expect(e[0].message).toMatch(/contraste/);
    expect(contrastRatio('#f7f7c0', '#ffffff')).toBeLessThan(MIN_CONTRAST);
  });

  it('o próprio default passa na guarda de contraste (claro e escuro)', () => {
    expect(validateTheme({ primary: DEFAULT_THEME.primary, card: '#ffffff' })).toEqual([]);
    expect(validateTheme({ primaryDark: DEFAULT_THEME.primaryDark, mode: 'dark' })).toEqual([]);
  });
});

describe('coerência da marca', () => {
  it('a 1ª cor da paleta de gráficos É a cor primária', () => {
    // A regressão que motivou o módulo: interface verde e série 1 azul.
    expect(chartPaletteOf(DEFAULT_THEME)[0]).toBe(DEFAULT_THEME.primary);
  });

  it('--primary honra o primary configurado, nos dois modos', () => {
    expect(themeVars({ primary: '#0b5d1e' })['--primary']).toBe('#0b5d1e');
    expect(themeVars({ mode: 'dark', primaryDark: '#9be89b' })['--primary']).toBe('#9be89b');
    // --data e --primary são a MESMA cor desde que a paleta azul saiu
    const v = themeVars({ primary: '#0b5d1e' });
    expect(v['--data']).toBe(v['--primary']);
  });
});

describe('paridade entre os 3 ambientes', () => {
  it('o CSS publicado declara TODOS os tokens que o editor declara', () => {
    // Guarda contra a deriva que existia: 23 tokens no editor, 6 no publicado.
    const css = publishCss(DEFAULT_THEME);
    for (const token of Object.keys(themeVars(DEFAULT_THEME))) {
      expect(css).toContain(`${token}:`);
    }
  });

  it('o CSS publicado carrega os VALORES do tema resolvido, não literais fixos', () => {
    const css = publishCss(resolveTheme({}, { primary: '#0b5d1e' }));
    expect(css).toContain('--primary:#0b5d1e');
    expect(css).toContain('--data:#0b5d1e');
  });
});

describe('PRESETS — identidade inteira sem copiar hex', () => {
  it('todo preset é válido, fechado ao conjunto de marca e passa nas guardas', () => {
    for (const name of PRESET_NAMES) {
      const preset = PRESETS[name];
      expect(validateTheme(preset), name).toEqual([]);
      expect(Object.keys(preset).every((k) => BRAND_KEYS.includes(k)), name).toBe(true);
    }
  });

  it('preset desconhecido é erro, com a lista do que existe', () => {
    const e = validateTheme({ preset: 'capes-2019' });
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe('theme.preset');
    expect(e[0].message).toMatch(new RegExp(PRESET_NAMES.join('|')));
  });

  it('o preset do PROJETO vence os tokens explícitos do global', () => {
    // Sem isso o preset seria inútil: o settings global sempre carrega todos os
    // tokens (mergeWithDefaults), e venceria o preset declarado pelo projeto.
    const t = resolveTheme({ primary: '#111111' }, { preset: 'govbr' });
    expect(t.primary).toBe(PRESETS.govbr.primary);
  });

  it('tokens ao lado do preset ajustam a base, e `preset` não sobra no resolvido', () => {
    const t = resolveTheme(null, { preset: 'govbr', primary: '#0c326f' });
    expect(t.primary).toBe('#0c326f'); // override do autor
    expect(t.card).toBe(PRESETS.govbr.card); // resto vem do preset
    expect(t.preset).toBeUndefined(); // seletor, não token
  });

  it('a guarda de contraste enxerga preset + override combinados', () => {
    // Nenhuma das duas chaves isolada é inválida; juntas somem uma na outra.
    const e = validateTheme({ preset: 'govbr', card: PRESETS.govbr.primary });
    expect(e).toHaveLength(1);
    expect(e[0].path).toBe('theme.card');
    expect(e[0].message).toMatch(/contraste/);
  });
});

describe('chartPaletteOf — paleta do MODO corrente', () => {
  it('no escuro prefere chartPaletteDark quando o tema declara uma', () => {
    const t = resolveTheme(null, { preset: 'govbr', mode: 'dark' });
    expect(chartPaletteOf(t)).toEqual(PRESETS.govbr.chartPaletteDark);
    expect(chartPaletteOf({ ...t, mode: 'light' })).toEqual(PRESETS.govbr.chartPalette);
  });

  it('sem paleta escura declarada, cai na clara (sem regressão)', () => {
    expect(chartPaletteOf({ mode: 'dark', chartPalette: ['#111111'] })).toEqual(['#111111']);
    expect(chartPaletteOf({ mode: 'dark' })).toEqual(DEFAULT_THEME.chartPalette);
  });

  it('a paleta escura do govbr é legível sobre a superfície escura do próprio preset', () => {
    // A regressão que motivou o par: a paleta CLARA do gov.br cai para ~1,1:1
    // sobre #0c326f — inutilizável no modo escuro.
    const { cardDark, chartPalette, chartPaletteDark } = PRESETS.govbr;
    for (const c of chartPaletteDark) expect(contrastRatio(c, cardDark)).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...chartPalette.map((c) => contrastRatio(c, cardDark)))).toBeLessThan(3);
  });
});
