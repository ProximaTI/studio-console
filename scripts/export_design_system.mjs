// Exporta o design system num pacote REUTILIZÁVEL fora deste código-fonte:
//
//   npm run design:export        ->  design-system/{tokens.css,tokens.json,README.md}
//
// Os valores não são digitados aqui: os de MARCA vêm de shared/designTokens.js
// (DEFAULT_THEME + PRESETS) e os ESTRUTURAIS são lidos do :root de
// web/src/styles.css. Uma fonte só, como os compiladores de SQL — o export é
// uma PROJEÇÃO, nunca uma segunda cópia que pode divergir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAND_KEYS,
  DEFAULT_THEME,
  PRESETS,
  PRESET_NAMES,
  STRUCTURAL_KEYS,
  chartPaletteOf,
  parseRootTokens,
  resolveTheme,
  themeVars,
} from '../shared/designTokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'design-system');
const STYLES = path.join(ROOT, 'web', 'src', 'styles.css');

/** Tokens estruturais (valor lido do CSS) + os que faltarem, com aviso. */
export function structuralTokens(cssText) {
  const all = parseRootTokens(cssText);
  const out = {};
  const missing = [];
  for (const k of STRUCTURAL_KEYS) {
    if (all[k] === undefined) missing.push(k);
    else out[k] = all[k];
  }
  return { tokens: out, missing };
}

const cssBlock = (selector, tokens) =>
  `${selector} {\n` +
  Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n') +
  '\n}\n';

/** Gera o conteúdo dos arquivos do pacote. Puro — o teste chama direto. */
export function buildFiles(cssText, { generatedAt } = {}) {
  const { tokens: structural, missing } = structuralTokens(cssText);
  const stamp = generatedAt || new Date().toISOString().slice(0, 10);

  // --- tokens.css ---------------------------------------------------------
  const themeOf = (preset, mode) => resolveTheme(null, { ...(preset ? { preset } : {}), mode });
  const head =
    `/* Studio Console — design system\n` +
    `   GERADO por scripts/export_design_system.mjs em ${stamp} — não edite à mão.\n` +
    `   Marca: shared/designTokens.js · Estrutural: web/src/styles.css\n\n` +
    `   Uso: <html data-mode="light"> e, para adotar um preset inteiro,\n` +
    `        <html data-preset="govbr">. Sem data-preset vale o tema padrão. */\n\n`;

  let css = head;
  css += '/* ---- estruturais: iguais em TODO relatório, em qualquer marca ---- */\n';
  css += cssBlock(':root', structural);
  css += '\n/* ---- tema padrão ---- */\n';
  css += cssBlock(':root', themeVars(themeOf(null, 'light')));
  css += cssBlock(':root[data-mode="dark"]', themeVars(themeOf(null, 'dark')));
  for (const name of PRESET_NAMES) {
    css += `\n/* ---- preset "${name}" ---- */\n`;
    css += cssBlock(`:root[data-preset="${name}"]`, themeVars(themeOf(name, 'light')));
    css += cssBlock(`:root[data-preset="${name}"][data-mode="dark"]`, themeVars(themeOf(name, 'dark')));
  }

  // --- tokens.json --------------------------------------------------------
  const themeEntry = (preset) => {
    const light = themeOf(preset, 'light');
    const dark = themeOf(preset, 'dark');
    return {
      brand: preset ? PRESETS[preset] : DEFAULT_THEME,
      series: { light: chartPaletteOf(light), dark: chartPaletteOf(dark) },
      vars: { light: themeVars(light), dark: themeVars(dark) },
    };
  };
  const json = {
    generatedAt: stamp,
    source: 'studio-console',
    brandKeys: BRAND_KEYS,
    structural,
    default: themeEntry(null),
    presets: Object.fromEntries(PRESET_NAMES.map((n) => [n, themeEntry(n)])),
  };

  return { 'tokens.css': css, 'tokens.json': JSON.stringify(json, null, 2) + '\n', missing };
}

/**
 * Folha de amostras: abre no navegador e mostra o sistema aplicado, com
 * alternância de preset e de modo. Consome APENAS tokens.css e tokens.json —
 * se o pacote estiver quebrado, esta página quebra junto (é o teste de fumaça
 * de quem recebe o export).
 */
export function buildPreview(stamp) {
  return `<!doctype html>
<html lang="pt-BR" data-mode="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design system — amostras</title>
<link rel="stylesheet" href="tokens.css">
<style>
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--ui);font-size:14px}
  .wrap{max-width:900px;margin:0 auto;padding:32px 24px 80px}
  h1{font-size:24px;margin:0 0 4px} h2{font-size:16px;margin:32px 0 12px}
  .sub{color:var(--muted);margin:0 0 24px}
  .bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  button{font:inherit;cursor:pointer;padding:8px 14px;border-radius:var(--radius-ctrl);
         border:1px solid var(--line2);background:var(--panel);color:var(--text)}
  button[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:var(--card)}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-card);
        padding:14px 16px;box-shadow:var(--shadow-frame)}
  .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .v{font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
  table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);
        border-radius:var(--radius-card);overflow:hidden}
  th,td{padding:var(--rowpad) 12px;border-bottom:1px solid var(--line);text-align:left}
  th{background:var(--bg);font-weight:600} td code{font-family:var(--mono);color:var(--muted)}
  .sw{display:flex;gap:6px;flex-wrap:wrap}
  .sw i{width:52px;height:52px;border-radius:var(--radius-ctrl);border:1px solid var(--line)}
  .pill{display:inline-block;padding:4px 12px;border-radius:var(--radius-pill);
        background:var(--primary);color:var(--card);font-size:12px;font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <h1>Design system — amostras</h1>
  <p class="sub">Pacote gerado em ${stamp}. Tudo abaixo usa só <code>tokens.css</code>.</p>

  <div class="bar" id="presets"></div>
  <div class="bar" id="modes"></div>

  <h2>Superfícies e cartões</h2>
  <div class="cards">
    <div class="card"><div class="k">Qtd. APC</div><div class="v">18.997</div></div>
    <div class="card"><div class="k">Qtd. IES</div><div class="v">302</div></div>
    <div class="card"><div class="k">Destaque</div><div class="v"><span class="pill">primário</span></div></div>
  </div>

  <h2>Séries de gráfico</h2>
  <div class="sw" id="series"></div>

  <h2>Tabela</h2>
  <table><thead><tr><th>Token</th><th>Papel</th></tr></thead><tbody>
    <tr><td><code>--bg</code></td><td>fundo da página</td></tr>
    <tr><td><code>--card</code></td><td>superfície de cartão e tabela</td></tr>
    <tr><td><code>--primary</code></td><td>cor de marca (texto, ícone, destaque)</td></tr>
    <tr><td><code>--line</code></td><td>divisórias</td></tr>
  </tbody></table>
</div>
<script>
const root = document.documentElement;
fetch('tokens.json').then(r => r.json()).then(t => {
  const presets = ['(padrão)', ...Object.keys(t.presets)];
  const draw = (host, list, get, set) => {
    host.innerHTML = '';
    for (const v of list) {
      const b = document.createElement('button');
      b.textContent = v;
      b.onclick = () => { set(v); paint(); };
      b.dataset.v = v;
      host.appendChild(b);
    }
  };
  const setPreset = (v) => v === '(padrão)' ? root.removeAttribute('data-preset') : root.setAttribute('data-preset', v);
  const setMode = (v) => root.setAttribute('data-mode', v);
  const paint = () => {
    const p = root.getAttribute('data-preset') || '(padrão)';
    const m = root.getAttribute('data-mode');
    for (const b of document.querySelectorAll('#presets button')) b.setAttribute('aria-pressed', String(b.dataset.v === p));
    for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-pressed', String(b.dataset.v === m));
    const entry = p === '(padrão)' ? t.default : t.presets[p];
    document.getElementById('series').innerHTML =
      entry.series[m].map((c) => '<i style="background:' + c + '" title="' + c + '"></i>').join('');
  };
  draw(document.getElementById('presets'), presets, null, setPreset);
  draw(document.getElementById('modes'), ['light', 'dark'], null, setMode);
  paint();
});
</script>
</body>
</html>
`;
}

export function buildReadme(stamp) {
  return `# Design system — Studio Console

Pacote **gerado** por \`npm run design:export\` em ${stamp}. Não edite estes
arquivos: mude a fonte e exporte de novo.

| Arquivo | Para quê |
| --- | --- |
| \`tokens.css\` | CSS custom properties prontas — qualquer página/app web |
| \`tokens.json\` | os mesmos valores em dados — build, Figma, outra stack |
| \`preview.html\` | folha de amostras: abra no navegador, troque preset e modo |

## Duas famílias de token

- **Marca** (${BRAND_KEYS.join(', ')}): muda por cliente/projeto.
- **Estrutural** (${STRUCTURAL_KEYS.join(', ')}): raios, sombra, espaçamento e
  fontes. **Não** são sobrescrevíveis — é o que faz todo relatório parecer o
  mesmo produto mesmo com marcas diferentes.

Presets disponíveis: ${PRESET_NAMES.map((n) => `\`${n}\``).join(', ')}.

## Reusar em OUTRO relatório desta console

Uma linha no \`project.yaml\` do projeto — nada de copiar hex:

\`\`\`yaml
theme:
  preset: govbr
\`\`\`

O preset é a BASE; qualquer token de marca declarado ao lado dele ajusta o que
se quiser:

\`\`\`yaml
theme:
  preset: govbr
  chartPalette: ${JSON.stringify(PRESETS[PRESET_NAMES[0]].chartPalette.slice(0, 3))}   # só as séries mudam
\`\`\`

Regras que o validador aplica ao salvar: token fora do conjunto de marca é
**erro**, e primário ilegível sobre o cartão é **recusado** (mínimo 3:1).
O modo claro/escuro **não** vem do preset — segue o global em Settings.

### Logotipos

Os SVGs são marca, não código: não versionam. Com acesso à rede interna:

\`\`\`bash
node scripts/fetch_brand_assets.mjs
\`\`\`

Na página, \`<img>\` (e não \`![](…)\`) é o que permite tamanho — vários logos,
o da CAPES entre eles, só têm \`viewBox\` e sem largura esticariam a coluna
inteira:

\`\`\`html
<img src="/brand/capes.svg" alt="CAPES" width=190/>
\`\`\`

No publish a imagem é embutida como data URI, então o 📦 continua sendo um
arquivo só e o ☁ não depende de caminho.

## Reusar FORA da console

\`\`\`html
<link rel="stylesheet" href="tokens.css">
<html data-preset="govbr" data-mode="light">
\`\`\`

Depois é só consumir as variáveis: \`background: var(--bg)\`,
\`color: var(--text)\`, \`border-color: var(--line)\`, \`color: var(--primary)\`.
As cores de série de gráfico estão em \`tokens.json\`
(\`presets.govbr.series.light\` e \`.dark\`) — há paleta por modo porque a clara
do gov.br cai para ~1,1:1 sobre superfície escura.

## Procedência dos valores

O preset \`govbr\` usa tokens reais do \`@govbr-ds/core\` 3.7.0 (MIT); o nome do
token de origem está no comentário de cada linha em \`shared/designTokens.js\`.
A paleta de séries clara vem da \`@psc/ui\` (biblioteca Vue/GovBR da CAPES),
porque o core do GovBR-DS não define paleta de séries; a escura são os passos
claros das mesmas famílias de cor do core.
`;
}

// --- execução -------------------------------------------------------------
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const stamp = new Date().toISOString().slice(0, 10);
  const { missing, ...files } = buildFiles(fs.readFileSync(STYLES, 'utf8'), { generatedAt: stamp });
  files['README.md'] = buildReadme(stamp);
  files['preview.html'] = buildPreview(stamp);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), content, 'utf8');
    console.log(`  ✓ design-system/${name}  (${Buffer.byteLength(content)} bytes)`);
  }
  if (missing.length) console.warn(`  ! sem valor no :root de styles.css: ${missing.join(', ')}`);
  console.log(`\n${PRESET_NAMES.length} preset(s) + tema padrão, claro e escuro.`);
}
