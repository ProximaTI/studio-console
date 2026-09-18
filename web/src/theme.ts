import { themeVars, DEFAULT_THEME } from '../../shared/designTokens.js';

export type Theme = {
  mode: string;
  background: string;
  card: string;
  primary: string;
  primaryDark?: string;
  chartPalette: string[];
  chartPaletteDark?: string[]; // paleta de séries do modo escuro (ver chartPaletteOf)
};

// Aplica os tokens de cor sobre as CSS variables. Os VALORES não moram aqui:
// vêm de shared/designTokens.js, a mesma fonte que o CSS dos publicados usa —
// é o que faz editor, 📦 e ☁ concordarem no visual.
//
// Tokens ESTRUTURAIS (raios, sombras, fontes, espaçamento) seguem no :root de
// styles.css: não dependem de modo nem são sobrescrevíveis por projeto.
export function applyTheme(t?: Theme) {
  if (!t) return;
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(themeVars(t))) r.setProperty(k, v as string);
  document.body.dataset.mode = t.mode || DEFAULT_THEME.mode;
}
