// Design system: VOCABULÁRIO e VALORES dos tokens de cor num lugar só, servindo
// os TRÊS ambientes (editor, 📦 snapshot, ☁ app). Mesmo princípio dos
// compiladores de shared/: uma fonte, três consumidores.
//
// Antes deste módulo os valores viviam duplicados em web/src/theme.ts e em
// server/publish/assets.js (publishCss) — e já haviam divergido em três pontos:
// 23 tokens no editor contra 6 no publicado; o editor IGNORAVA o `primary`
// configurado; e a paleta de gráficos começava no azul aposentado enquanto a
// interface era verde.
//
// Duas famílias de token:
//   MARCA      — sobrescrevível por projeto (`theme:` no project.yaml). É a
//                identidade que muda por cliente.
//   ESTRUTURAL — raios, sombras, espaçamento e fontes. Vivem no :root de
//                styles.css e NÃO são sobrescrevíveis: são o que faz todo
//                projeto parecer o mesmo produto.

/** Chaves de MARCA — o conjunto FECHADO que um projeto pode sobrescrever. */
export const BRAND_KEYS = [
  'mode',
  'background',
  'backgroundDark',
  'card',
  'cardDark',
  'primary',
  'primaryDark',
  'chartPalette',
  'chartPaletteDark',
];

/** Contraste mínimo entre `primary` e a superfície do cartão (WCAG, elemento de UI). */
export const MIN_CONTRAST = 3;

// Superfícies e primário têm par claro/escuro: uma cor só não serve aos dois
// modos. Antes, o `card` claro valia também no escuro — o modo escuro
// renderizava cartão branco, e a guarda de contraste media contra a superfície
// errada.
export const DEFAULT_THEME = {
  mode: 'light',
  background: '#ecefe8',
  backgroundDark: '#14161a',
  card: '#ffffff',
  cardDark: '#22262e',
  primary: '#2c8a4a',
  primaryDark: '#5fce84', // variante do primário para o modo escuro (legibilidade)
  // A 1ª cor da paleta é a da MARCA: a série 1 de todo gráfico concorda com a
  // interface. (Antes começava em #236aa4, azul, com a interface já em verde.)
  chartPalette: ['#2c8a4a', '#45a1bf', '#a5cdee', '#7b61ff', '#16a34a', '#f59e0b', '#dc2626', '#0891b2'],
};

/**
 * PRESETS de marca — identidades visuais prontas, para um projeto adotar um
 * padrão inteiro sem copiar hex. `theme: { preset: govbr }` no project.yaml.
 *
 * Um preset só declara tokens de MARCA (mesmo conjunto fechado): ele é a BASE
 * daquele nível, e os tokens declarados ao lado dele o ajustam.
 *
 * govbr — Padrão Digital de Governo (gov.br). TODOS os valores são tokens reais
 * do pacote público @govbr-ds/core 3.7.0 (MIT), lidos de core-tokens.css; o
 * nome do token do design system vai no comentário de cada linha. A paleta de
 * SÉRIES não existe no core do GovBR-DS: a clara é a usada pela @psc/ui (a
 * biblioteca Vue/GovBR da CAPES) e a escura são os passos claros das MESMAS
 * famílias de cor do core, porque a clara cai para 1,1:1 sobre superfície
 * escura — legibilidade por modo, igual aos pares background/card/primary.
 */
export const PRESETS = {
  govbr: {
    background: '#f8f8f8', //     --gray-2
    backgroundDark: '#071d41', //  --background-dark = --blue-warm-vivid-90
    card: '#ffffff', //            --background-light = --pure-0
    cardDark: '#0c326f', //        --blue-warm-vivid-80 (um passo acima do fundo)
    primary: '#1351b4', //         --interactive-light = --blue-warm-vivid-70
    primaryDark: '#c5d4eb', //     --interactive-dark = --blue-warm-20
    chartPalette: ['#AD5000', '#217B00', '#0069D0', '#003A79', '#630087', '#595959'], // @psc/ui
    chartPaletteDark: [
      '#ff8c00', //                --orange-vivid-30
      '#21c834', //                --green-cool-vivid-30
      '#58b4ff', //                --blue-vivid-30
      '#adcdff', //                --blue-warm-vivid-20
      '#c39deb', //                --violet-vivid-30
      '#adadad', //                --gray-30
    ],
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

/**
 * Tokens ESTRUTURAIS — vocabulário fechado, como BRAND_KEYS. Não são
 * sobrescrevíveis por projeto: são o que faz todo relatório parecer o mesmo
 * produto, mudando só a marca. Os VALORES moram no :root de web/src/styles.css
 * (CSS não importa JS); esta lista é o contrato do que o export precisa achar
 * lá — se alguém renomear um token no CSS, o teste do export acusa.
 */
export const STRUCTURAL_KEYS = [
  '--radius-card',
  '--radius-ctrl',
  '--radius-pill',
  '--shadow-frame',
  '--rowpad',
  '--ui',
  '--mono',
];

/** Lê `--token: valor` do PRIMEIRO bloco :root de um CSS. Usado pelo export. */
export function parseRootTokens(cssText) {
  const block = String(cssText).match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) return {};
  const out = {};
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  }
  return out;
}

/**
 * Tokens de cor resolvidos para CSS custom properties.
 * É a ÚNICA definição dos valores — editor e publicados consomem daqui.
 */
export function themeVars(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const dark = t.mode === 'dark';
  const brand = dark ? t.primaryDark || DEFAULT_THEME.primaryDark : t.primary || DEFAULT_THEME.primary;
  const { bg, card } = surfacesOf(t);
  return {
    // superfícies
    '--bg': bg,
    '--ink': dark ? '#1b1e24' : '#f3f4f0',
    '--panel': card,
    '--panel2': dark ? '#262b34' : '#fafaf8',
    '--panel3': dark ? '#2c313b' : '#eef0ea',
    '--card': card,
    // linhas
    '--line': dark ? '#333944' : '#e6e8e1',
    '--line2': dark ? '#434b58' : '#d6d9d0',
    '--border': dark ? '#333944' : '#e6e8e1', // alias legado -> --line
    // texto
    '--text': dark ? '#e7e9e4' : '#1b1e1a',
    '--muted': dark ? '#9aa39a' : '#5d645c',
    '--dim': dark ? '#6b7269' : '#9aa197',
    // cor de marca (--primary e --data são o mesmo desde que a paleta azul saiu)
    '--data': brand,
    '--primary': brand,
    '--amberink': dark ? '#e2b45a' : '#a4670a',
  };
}

/** Superfícies do modo corrente — o par claro/escuro resolvido. */
export function surfacesOf(theme) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const dark = t.mode === 'dark';
  return {
    bg: dark ? t.backgroundDark || DEFAULT_THEME.backgroundDark : t.background || DEFAULT_THEME.background,
    card: dark ? t.cardDark || DEFAULT_THEME.cardDark : t.card || DEFAULT_THEME.card,
  };
}

/** Superfície contra a qual o primário precisa ter contraste, no modo dado. */
export function cardOf(theme) {
  return surfacesOf(theme).card;
}

/**
 * Paleta de séries do MODO corrente — fim dos fallbacks espalhados pelos
 * componentes. No escuro usa `chartPaletteDark` quando o tema declara uma;
 * sem ela, cai na clara (comportamento de sempre, sem regressão).
 */
export function chartPaletteOf(theme) {
  const t = theme || {};
  const list = (p) => (Array.isArray(p) && p.length ? p : null);
  if (t.mode === 'dark') return list(t.chartPaletteDark) || list(t.chartPalette) || DEFAULT_THEME.chartPalette;
  return list(t.chartPalette) || DEFAULT_THEME.chartPalette;
}

/**
 * Tema efetivo de um projeto: default → global → projeto, e em CADA nível o
 * `preset:` entra antes dos tokens declarados ao lado dele. Assim um projeto
 * que adota `preset: govbr` recebe o padrão inteiro mesmo que o settings global
 * declare cores próprias — senão o preset do projeto perderia para o global.
 *
 * Merge RASO por chave, no mesmo espírito do mergeWithDefaults do settings.
 * `preset` é um SELETOR, não um token: não sobra no tema resolvido.
 */
export function resolveTheme(globalTheme, projectTheme) {
  const only = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => BRAND_KEYS.includes(k)));
  const preset = (o) => PRESETS[(o || {}).preset] || {};
  return {
    ...DEFAULT_THEME,
    ...preset(globalTheme),
    ...only(globalTheme),
    ...preset(projectTheme),
    ...only(projectTheme),
  };
}

// ---- validação -------------------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Luminância relativa (WCAG 2.x) de um hex #rgb/#rrggbb. */
export function relativeLuminance(hex) {
  let h = String(hex).replace('#', '').slice(0, 6);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Razão de contraste entre duas cores (1..21). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Valida um bloco `theme:`. Retorna [{path, message}] — vazio = válido.
 * Conjunto FECHADO: token fora de BRAND_KEYS é ERRO, não aviso — a mesma
 * disciplina dos construtores fechados do catálogo semântico.
 * `prefix` prefixa os caminhos (ex.: 'theme').
 */
export function validateTheme(theme, prefix = 'theme') {
  const errors = [];
  const p = (k) => (prefix ? `${prefix}.${k}` : k);
  if (theme === undefined || theme === null) return errors;
  if (typeof theme !== 'object' || Array.isArray(theme)) {
    return [{ path: prefix, message: 'deve ser um mapa de tokens' }];
  }

  for (const k of Object.keys(theme)) {
    if (k === 'preset') continue; // seletor de preset, validado logo abaixo
    if (!BRAND_KEYS.includes(k)) {
      errors.push({
        path: p(k),
        message: `"${k}" não é sobrescrevível por projeto — tokens de marca: ${BRAND_KEYS.join(', ')} (raios, fontes e espaçamento são estruturais)`,
      });
    }
  }
  if (theme.preset !== undefined && !PRESET_NAMES.includes(theme.preset)) {
    errors.push({ path: p('preset'), message: `preset desconhecido — disponíveis: ${PRESET_NAMES.join(', ')}` });
  }
  if (theme.mode !== undefined && !['light', 'dark'].includes(theme.mode)) {
    errors.push({ path: p('mode'), message: 'light ou dark' });
  }
  for (const k of ['background', 'backgroundDark', 'card', 'cardDark', 'primary', 'primaryDark']) {
    if (theme[k] !== undefined && !HEX.test(String(theme[k]))) {
      errors.push({ path: p(k), message: 'cor hex (ex.: #2c8a4a)' });
    }
  }
  for (const key of ['chartPalette', 'chartPaletteDark']) {
    if (theme[key] === undefined) continue;
    if (!Array.isArray(theme[key]) || !theme[key].length) {
      errors.push({ path: p(key), message: 'lista não-vazia de cores hex' });
    } else {
      theme[key].forEach((c, i) => {
        if (!HEX.test(String(c))) errors.push({ path: `${p(key)}[${i}]`, message: 'cor hex (ex.: #2c8a4a)' });
      });
    }
  }

  // Guarda de legibilidade — mesma ideia das guardas do catálogo (cardinality,
  // semi_additive): recusa configuração incorreta com erro educativo.
  //
  // Mede sobre o tema RESOLVIDO (preset + tokens declarados), não sobre o que
  // o autor digitou: `{preset: govbr, card: '#1351b4'}` deixaria o primário do
  // preset invisível sobre o cartão, e nenhuma das duas chaves isolada acusa.
  if (!errors.length) {
    const resolved = resolveTheme(null, theme);
    for (const [k, mode] of [['primary', 'light'], ['primaryDark', 'dark']]) {
      const surface = cardOf({ ...resolved, mode });
      if (!HEX.test(String(surface)) || !HEX.test(String(resolved[k]))) continue;
      const r = contrastRatio(resolved[k], surface);
      if (r < MIN_CONTRAST) {
        // Aponta para a chave que o AUTOR declarou (é o que ele pode corrigir):
        // o primário, se veio dele; senão a superfície; senão o preset.
        const cardKey = mode === 'dark' ? 'cardDark' : 'card';
        const blame = theme[k] !== undefined ? k : theme[cardKey] !== undefined ? cardKey : 'preset';
        errors.push({
          path: p(blame),
          message: `contraste ${r.toFixed(2)}:1 entre ${resolved[k]} e a superfície ${surface} — mínimo ${MIN_CONTRAST}:1 para ser legível`,
        });
      }
    }
  }
  return errors;
}
