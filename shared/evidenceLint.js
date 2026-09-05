// Linter de compatibilidade Evidence.dev.
// A console é para PROTOTIPAR; o deploy final é um Evidence on-premise, onde a
// sintaxe Evidence é canônica. Este módulo avisa, ainda no editor, o que vai
// quebrar ou renderizar diferente no deploy — antes da surpresa.
//
// Níveis:
//   error — vai quebrar no Evidence (ou em ambos)
//   warn  — exige ação antes do deploy (sintaxe/componente a ajustar)
//   info  — funciona, mas com diferença ou atenção necessária
//
// As tabelas de componentes são CURADAS (Evidence core-components ~v40); ajuste
// aqui quando a versão-alvo do Evidence mudar.
import { parseBlocks, parseFrontmatter } from './parser.js';

// Componentes que a console renderiza (registry de web/src/render/markdown.tsx
// + shared/publishRender.js). Manter em sincronia ao adicionar componentes.
const CONSOLE_COMPONENTS = new Set([
  'BigValue', 'BarChart', 'LineChart', 'BubbleChart', 'DataTable', 'Column',
  'Dropdown', 'DropdownOption', 'ConnectionMap', 'CollaborationGraph',
  'Note', 'LinkButton', 'Grid', 'Card', 'CardTitle', 'CardBody',
  'Tabs', 'Tab', 'Details', 'Value', 'AreaMap', 'div',
  'TextInput', 'Slider', 'DateRange', 'Repeat',
]);

// Componentes do Evidence core (docs.evidence.dev). Lista curada.
const EVIDENCE_COMPONENTS = new Set([
  'Accordion', 'AccordionItem', 'Alert', 'AreaChart', 'AreaMap', 'BarChart',
  'BigLink', 'BigValue', 'BoxPlot', 'BubbleChart', 'BubbleMap', 'ButtonGroup',
  'ButtonGroupItem', 'CalendarHeatmap', 'Checkbox', 'Column', 'DataTable',
  'DateRange', 'Delta', 'Details', 'DimensionGrid', 'Dropdown', 'DropdownOption',
  'ECharts', 'Embed', 'FunnelChart', 'Grid', 'Heatmap', 'Histogram', 'Info',
  'LastRefreshed', 'LineBreak', 'LineChart', 'LinkButton', 'Modal', 'Note',
  'PointMap', 'SankeyDiagram', 'ScatterPlot', 'Slider', 'Sparkline',
  'Tab', 'Tabs', 'TextInput', 'Value',
]);

// Custom na console: no Evidence exigem um componente Svelte instalado no projeto.
const CUSTOM_NEEDS_PORT = {
  CollaborationGraph:
    'componente custom — no deploy Evidence, instale o port Svelte (já existe no repo, criado junto com a versão React)',
  ConnectionMap:
    'componente custom da console — não existe no Evidence core; será preciso criar um componente Svelte no projeto Evidence',
  Repeat:
    'container Nested (F3) — pleno no runtime próprio e nos dois Publish; deploy Evidence exige Repeat.svelte (P2 sob demanda)',
};

// Existem na console mas NÃO no Evidence core.
const NOT_IN_EVIDENCE = {
  Card: 'não existe no Evidence core — no deploy, troque por <Grid> + markdown, <BigLink> ou HTML',
  CardTitle: 'não existe no Evidence core — use um heading markdown (##) no lugar',
  CardBody: 'não existe no Evidence core — o conteúdo pode ficar direto no container',
};

// Renderizam DIFERENTE na console (funcionam nos dois lados).
const RENDER_DIFF = {
  Tabs: 'a console empilha os painéis um abaixo do outro; no Evidence viram abas reais',
};

// Tags HTML comuns são válidas nos dois lados (markdown aceita HTML).
const HTML_TAGS = new Set([
  'div', 'span', 'p', 'a', 'b', 'i', 'u', 'em', 'strong', 'br', 'hr', 'img',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre',
  'details', 'summary', 'section', 'small', 'sub', 'sup',
]);

/** Queries externas do frontmatter: [{ name, file }] (para o chamador buscar e lintar). */
export function frontmatterQueries(mdSource) {
  const { meta } = parseFrontmatter(mdSource);
  return meta?.queries || [];
}

/**
 * Linta uma página .md (e opcionalmente as queries externas já resolvidas).
 * @param {string} mdSource fonte da página
 * @param {{queries?: {name:string, sql:string}[]}} opts .sql do frontmatter
 * @returns {{level:'error'|'warn'|'info', code:string, message:string, context:string}[]}
 */
export function lintEvidenceCompat(mdSource, opts = {}) {
  const findings = [];
  const seen = new Set();
  const add = (level, code, message, context) => {
    const k = code + '|' + context + '|' + message;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push({ level, code, message, context });
  };

  let blocks;
  try {
    blocks = parseBlocks(mdSource);
  } catch (e) {
    add('error', 'parse', 'falha ao parsear a página: ' + (e?.message || e), 'página');
    return findings;
  }

  // Pré-passo: inputs de TEXTO PLANO (TextInput/Slider) — para esses, o
  // canônico Evidence é ${inputs.x} SEM .value (só o Dropdown exige .value).
  const plainInputs = new Set();
  const collectPlain = (list) => {
    for (const b of list || []) {
      if (b.type === 'component') {
        if ((b.name === 'TextInput' || b.name === 'Slider') && b.attrs?.name) plainInputs.add(b.attrs.name);
        if (b.children) collectPlain(b.children);
      }
    }
  };
  collectPlain(blocks);

  const walk = (list) => {
    for (const b of list || []) {
      if (b.type === 'component') {
        const n = b.name;
        if (CUSTOM_NEEDS_PORT[n]) add('warn', 'custom-component', CUSTOM_NEEDS_PORT[n], `<${n}>`);
        else if (NOT_IN_EVIDENCE[n]) add('warn', 'console-only', NOT_IN_EVIDENCE[n], `<${n}>`);
        else if (RENDER_DIFF[n]) add('info', 'render-diff', RENDER_DIFF[n], `<${n}>`);
        else if (!CONSOLE_COMPONENTS.has(n) && !EVIDENCE_COMPONENTS.has(n) && !HTML_TAGS.has(n.toLowerCase()))
          add('error', 'unknown-component', 'componente desconhecido — não existe na console nem no Evidence core', `<${n}>`);
        else if (EVIDENCE_COMPONENTS.has(n) && !CONSOLE_COMPONENTS.has(n))
          add('info', 'console-missing', 'existe no Evidence, mas a console ainda não renderiza (o preview mostra fallback)', `<${n}>`);
        if (b.children) walk(b.children);
      }
      if (b.type === 'sql') lintSql(b.sql, '```sql ' + b.name, add, plainInputs);
      if (b.type === 'md') lintInline(b.text, add);
    }
  };
  walk(blocks);
  for (const q of opts.queries || []) lintSql(q.sql, 'queries/' + q.name, add, plainInputs);

  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return findings;
}

function lintSql(sql, context, add, plainInputs = new Set()) {
  const s = String(sql || '');
  // ${inputs.x} sem .value: para DROPDOWN o Evidence exige .value (o atalho só
  // funciona na console). TextInput/Slider usam ${inputs.x} — canônico, sem aviso.
  for (const m of s.matchAll(/\$\{\s*inputs\.([A-Za-z_]\w*)\s*\}/g)) {
    if (plainInputs.has(m[1])) continue;
    add('warn', 'inputs-no-value', `no Evidence use \${inputs.${m[1]}.value} — o atalho sem .value só funciona na console`, context);
  }
  // Alias legado ${$page.params.x} -> canônico ${params.x}.
  for (const m of s.matchAll(/\$\{\s*\$page\.params\.([A-Za-z_]\w*)\s*\}/g)) {
    add('warn', 'page-params-alias', `sintaxe legada — o canônico Evidence é \${params.${m[1]}}`, context);
  }
  // Scan AO VIVO em página (Fase Fontes §1): erro — o publish vai recusar.
  if (/\b(postgres_scan|mysql_scan|sqlite_scan|read_mysql|read_postgres)\s*\(|\bATTACH\b/i.test(s)) {
    add('error', 'live-scan', 'scan ao vivo (ATTACH/postgres_scan…) não entra em página — extraia via view materializada (↻); ao vivo só no SQL Console', context);
  }
  // Tabela qualificada por schema (ex.: vendas.base): no Evidence isso exige
  // uma source com o nome do schema.
  for (const m of s.matchAll(/\b(?:from|join)\s+([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/gi)) {
    if (m[1].toLowerCase() === 'information_schema') continue;
    add('info', 'schema-source', `"${m[1]}.${m[2]}" — no projeto Evidence, crie uma source chamada "${m[1]}" com a tabela "${m[2]}"`, context);
  }
}

function lintInline(text, add) {
  const s = String(text || '');
  // Alias legado {$page.params.x} -> canônico {params.x}.
  for (const m of s.matchAll(/\{\s*\$page\.params\.([A-Za-z_]\w*)/g)) {
    add('warn', 'page-params-alias', `sintaxe legada — o canônico Evidence é {params.${m[1]}}`, 'markdown');
  }
}
