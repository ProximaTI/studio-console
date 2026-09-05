// Helpers de PREPARO do publish (server-side): resolução de queries, detecção de
// fontes, itens recursivos e páginas parametrizadas. Sem HTML aqui.
import fs from 'node:fs';
import path from 'node:path';
import { getConnection } from '../db.js';
import { stripHtmlComments } from '../../shared/parser.js';

/** Blocos ```sql em qualquer nível (inclusive dentro de containers). */
export function collectSqlBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'sql') out.push({ name: b.name, sql: b.sql });
    if (b.children) out.push(...collectSqlBlocks(b.children));
  }
  return out;
}

/**
 * Queries da página: .sql externos do frontmatter (queries/) + blocos inline.
 * Bloco inline com o mesmo nome SOBRESCREVE o externo (mesma regra do editor).
 */
export function resolveQueries(blocks, queriesDir) {
  const list = [];
  const meta = blocks[0]?.type === 'frontmatter' ? blocks[0].meta : null;
  for (const q of meta?.queries || []) {
    if (!queriesDir) continue;
    const f = path.join(queriesDir, q.file);
    if (!fs.existsSync(f)) throw new Error(`Query do frontmatter não encontrada: queries/${q.file}`);
    list.push({ name: q.name, sql: fs.readFileSync(f, 'utf8') });
  }
  for (const q of collectSqlBlocks(blocks)) {
    const i = list.findIndex((x) => x.name === q.name);
    if (i >= 0) list[i] = q;
    else list.push(q);
  }
  return list;
}

// Scan AO VIVO (postgres_scan/ATTACH…) é exploração do SQL Console do
// arquiteto — em PÁGINA é erro (spec Fontes §1): runtime só lê parquet.
const LIVE_SCAN_RE = /\b(postgres_scan|mysql_scan|sqlite_scan|read_mysql|read_postgres)\s*\(|\bATTACH\b/i;
export function findLiveScan(queries) {
  const hit = (queries || []).find((q) => LIVE_SCAN_RE.test(q.sql));
  return hit ? hit.name : null;
}

/** Fontes (views do schema main) referenciadas pelas queries. */
export function detectSources(queries, sourceNames) {
  const used = new Set();
  for (const q of queries) {
    for (const name of sourceNames) {
      const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (re.test(q.sql)) used.add(name);
    }
  }
  return [...used];
}

/**
 * Views em schemas próprios NÃO-projeto (ex.: legado vendas.base). Os schemas
 * de projeto (proj_*) são fontes normais e saem via detectSources — excluí-los
 * aqui evita exportar o parquet em dobro.
 */
export async function listSchemaViews(project = 'scratch') {
  const conn = await getConnection(project);
  const r = await conn.runAndReadAll(
    `select table_schema as s, table_name as t from information_schema.tables
     where table_schema not in ('main','information_schema','pg_catalog','temp')
       and table_schema not like 'proj\\_%' escape '\\'`
  );
  return r.getRowObjects().map((x) => ({ schema: String(x.s), table: String(x.t) }));
}

/**
 * Itens em ordem para o runtime publicado (recursivo: containers levam filhos).
 * Markdown vai CRU (sem comentários HTML) — a interpolação {..} roda no cliente.
 * Dropdown vira item próprio com staticOptions (<DropdownOption/>) + dataQuery.
 */
export function itemsFromBlocks(blocks) {
  return (blocks || [])
    .map((b) => {
      if (b.type === 'md') return { type: 'md', text: stripHtmlComments(b.text) };
      if (b.type === 'component') {
        if (b.name === 'Dropdown') {
          return {
            type: 'dropdown',
            name: b.attrs.name,
            dataQuery: b.attrs.data,
            value: b.attrs.value,
            label: b.attrs.label || b.attrs.value,
            title: b.attrs.title || '',
            staticOptions: (b.children || [])
              .filter((c) => c.type === 'component' && c.name === 'DropdownOption')
              .map((c) => ({ value: c.attrs.value ?? '', label: c.attrs.valueLabel ?? c.attrs.value ?? '' })),
          };
        }
        const item = { type: 'component', name: b.name, attrs: b.attrs };
        if (b.children) item.children = itemsFromBlocks(b.children);
        return item;
      }
      return null; // sql/frontmatter não renderizam
    })
    .filter(Boolean);
}

/** Dropdowns em qualquer nível dos itens (containers incluídos). */
export function walkDropdowns(items, cb) {
  for (const it of items || []) {
    if (it.type === 'dropdown') cb(it);
    if (it.children) walkDropdowns(it.children, cb);
  }
}

/** Páginas parametrizadas do projeto: { "unidade": "unidade", ... } */
export function collectParamPages(pagesDir) {
  const map = {};
  if (!pagesDir || !fs.existsSync(pagesDir)) return map;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name);
      else {
        const m = e.name.match(/^\[(\w+)\]\.md$/);
        if (m && rel) map[rel] = m[1];
      }
    }
  };
  walk(pagesDir, '');
  return map;
}

export function cartesian(arrs) {
  return arrs.reduce((acc, arr) => acc.flatMap((c) => arr.map((v) => [...c, v])), [[]]);
}

export function comboKey(inputNames, inputs) {
  return inputNames.map((n) => n + '=' + (inputs[n] ?? '')).join('&');
}
