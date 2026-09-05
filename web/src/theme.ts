export type Theme = {
  mode: string;
  background: string;
  card: string;
  primary: string;
  chartPalette: string[];
};

// Aplica os tokens do redesign (tema claro/escuro) sobre as CSS variables.
// Fonte da verdade da paleta clara é o :root de styles.css; aqui repetimos os
// fallbacks e derivamos o modo escuro. Cores de marca (--lime/--violet/--amber)
// são constantes e ficam no :root — não são sobrescritas por modo.
export function applyTheme(t?: Theme) {
  if (!t) return;
  const r = document.documentElement.style;
  const dark = t.mode === 'dark';
  const set = (k: string, v: string) => r.setProperty(k, v);

  // superfícies
  set('--bg', t.background || (dark ? '#14161a' : '#ecefe8'));
  set('--ink', dark ? '#1b1e24' : '#f3f4f0');
  set('--panel', t.card || (dark ? '#22262e' : '#ffffff'));
  set('--panel2', dark ? '#262b34' : '#fafaf8');
  set('--panel3', dark ? '#2c313b' : '#eef0ea');
  set('--card', t.card || (dark ? '#22262e' : '#ffffff'));
  // linhas
  set('--line', dark ? '#333944' : '#e6e8e1');
  set('--line2', dark ? '#434b58' : '#d6d9d0');
  set('--border', dark ? '#333944' : '#e6e8e1'); // alias legado -> --line
  // texto
  set('--text', dark ? '#e7e9e4' : '#1b1e1a');
  set('--muted', dark ? '#9aa39a' : '#5d645c');
  set('--dim', dark ? '#6b7269' : '#9aa197');
  // cor com significado que depende do modo p/ legibilidade
  set('--data', dark ? '#5fce84' : '#2c8a4a');
  set('--amberink', dark ? '#e2b45a' : '#a4670a');
  // alias legado: --primary segue --data (a paleta azul antiga foi aposentada)
  set('--primary', dark ? '#5fce84' : '#2c8a4a');

  document.body.dataset.mode = t.mode;
}
