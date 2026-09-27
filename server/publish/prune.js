// O que cada fonte LEVA para o pacote ☁ (auditoria de segurança 27/09/2026).
//
// Antes o publish exportava `SELECT *` de toda fonte citada: o app de orçamento
// saía com 28 colunas para ~11 usadas, e os apps do APC/IEEE entregavam autor e
// ORCID a qualquer visitante. Filtro visual não é controle de acesso — o que vai
// no Parquet, o navegador lê.
//
// Regra: vão só as colunas que alguma query da página referencia (lidas da AST
// do próprio DuckDB, não de regex), menos as internas/pii em publish público e
// as excluídas no project.yaml; as linhas passam pelo `where` declarado.
import { internalDims } from '../../shared/semanticCatalog.js';

/** Placeholders ${...} viram NULL só para a query ser PARSEÁVEL — nada executa. */
export function parseableSql(sql) {
  return String(sql).replace(/\$\{[^}]*\}/g, 'NULL');
}

/** AST do DuckDB (json_serialize_sql) — null se o parser recusar a query. */
export async function sqlAst(conn, sql) {
  const lit = parseableSql(sql).replace(/'/g, "''");
  try {
    const r = await conn.runAndReadAll(`select json_serialize_sql('${lit}') as j`);
    const ast = JSON.parse(String(r.getRows()[0][0]));
    return ast.error ? null : ast;
  } catch {
    return null;
  }
}

// Tabelas-base de um FROM, sem descer em subqueries (elas são SELECT_NODEs
// próprios e são visitadas por si).
function baseTables(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'BASE_TABLE') out.push(node);
  else if (node.type === 'JOIN') {
    baseTables(node.left, out);
    baseTables(node.right, out);
  }
  return out;
}

/**
 * Colunas citadas (nome final de cada COLUMN_REF, minúsculo) e fontes lidas com
 * `*` DIRETAMENTE (select * / t.* numa SELECT cujo FROM é a própria fonte).
 * `select * from cte` não conta: as colunas do CTE já estão nomeadas nele.
 */
export function analyzeAst(ast, sourceNames) {
  const wanted = new Set(sourceNames.map((s) => s.toLowerCase()));
  const cols = new Set();
  const star = new Set();
  const visit = (n) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    // TODOS os nomes do COLUMN_REF: em `t.col` o último é a coluna, em
    // `col.campo` (struct) é o primeiro. Sobra coluna, nunca falta.
    if (n.class === 'COLUMN_REF' && Array.isArray(n.column_names)) {
      for (const c of n.column_names) cols.add(String(c).toLowerCase());
    }
    // `join ... using (col)` não gera COLUMN_REF.
    if (Array.isArray(n.using_columns)) for (const c of n.using_columns) cols.add(String(c).toLowerCase());
    if (n.type === 'SELECT_NODE') {
      const stars = (n.select_list || []).filter((e) => e?.class === 'STAR');
      if (stars.length) {
        for (const t of baseTables(n.from_table)) {
          const name = String(t.table_name || '').toLowerCase();
          if (!wanted.has(name)) continue;
          const alias = String(t.alias || '').toLowerCase();
          if (stars.some((s) => !s.relation_name || [name, alias].includes(String(s.relation_name).toLowerCase()))) star.add(name);
        }
      }
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v);
  };
  visit(ast);
  return { cols, star };
}

/** Colunas do fato que pertencem a dimensões internas/pii, por fonte. */
export function internalColumns(catalogs) {
  const out = new Map(); // fonte -> Map(coluna minúscula -> motivo)
  for (const entry of catalogs || []) {
    if (!entry?.valid || !entry.catalog?.fact) continue;
    const cat = entry.catalog;
    const fact = String(cat.fact).toLowerCase();
    for (const dim of internalDims(cat)) {
      const d = cat.dimensions?.[dim] || {};
      const cs = [...(d.columns || []), d.column, d.bins?.column, d.map?.column].filter(Boolean);
      const why = cat.policies?.[dim]?.expose === 'internal' ? 'expose: internal' : 'pii';
      if (!out.has(fact)) out.set(fact, new Map());
      for (const c of cs) out.get(fact).set(String(c).toLowerCase(), `dimensão ${dim} (${why}) do modelo ${entry.model}`);
    }
  }
  return out;
}

/**
 * Nome de coluna com cara de dado pessoal (rede de segurança sem catálogo).
 * Por PALAVRA entre `_`: `autor_correspondente` e `codigo_pessoa` contam;
 * `autorizado`, `massa_autoral`, `single_author_works` e `tipo_pessoa` não —
 * contagem de autores é agregado, não pessoa.
 */
export function looksPersonal(column) {
  const t = String(column).toLowerCase().split('_').filter(Boolean);
  const has = (w) => t.includes(w);
  if (['orcid', 'cpf', 'rg', 'email', 'telefone', 'celular', 'phone'].some(has)) return true;
  if (has('autor') || has('autores')) return true;
  const s = t.join('_');
  if (/(^|_)(e_mail|nome_pessoa|codigo_pessoa|cpf_cnpj)(_|$)/.test(s)) return true;
  const i = t.findIndex((w) => w === 'author' || w === 'authors');
  if (i < 0 || ['n', 'nr', 'num', 'qtd', 'count', 'total'].includes(t[i - 1])) return false; // n_authors é contagem
  return i === t.length - 1 || ['name', 'nome', 'id', 'email'].includes(t[i + 1]);
}

/**
 * Plano de exportação de UMA fonte.
 *   columns    — colunas da fonte (nomes originais)
 *   analyses   — [{query, cols:Set, star:Set} | {query, unparsed:true}]
 *   cfg        — project.yaml publish.<fonte> ({where, exclude, allow})
 *   internal   — Map(coluna -> motivo) das dimensões internas da fonte
 *   visibility — 'public' | 'internal'
 * Devolve {select, where, kept, dropped, star, warnings, errors}.
 */
export function planSource({ name, columns, analyses, cfg = {}, internal = new Map(), visibility = 'public' }) {
  const lname = name.toLowerCase();
  const warnings = [];
  const errors = [];
  const excluded = new Set((cfg.exclude || []).map((c) => String(c).toLowerCase()));
  const publico = visibility !== 'internal';

  const usedBy = new Map(); // coluna minúscula -> [queries]
  let star = false;
  for (const a of analyses) {
    if (a.unparsed) {
      star = true;
      warnings.push(`${name}: a query ${a.query} não pôde ser analisada — a fonte sai com todas as colunas`);
      continue;
    }
    if (a.star.has(lname)) {
      star = true;
      warnings.push(`${name}: a query ${a.query} lê "*" direto da fonte — a fonte sai com todas as colunas`);
    }
    for (const c of a.cols) {
      if (!usedBy.has(c)) usedBy.set(c, []);
      usedBy.get(c).push(a.query);
    }
  }

  const kept = [];
  const dropped = [];
  for (const col of columns) {
    const lc = col.toLowerCase();
    const usada = star || usedBy.has(lc);
    const quem = usedBy.get(lc) || [];
    if (excluded.has(lc)) {
      if (quem.length) errors.push(`${name}.${col} está em publish.${name}.exclude, mas a query ${quem.join(', ')} usa a coluna`);
      dropped.push({ column: col, motivo: 'exclude no project.yaml' });
      continue;
    }
    if (publico && internal.has(lc)) {
      if (quem.length)
        errors.push(`Publish PÚBLICO recusado: a query ${quem.join(', ')} usa ${name}.${col} — ${internal.get(lc)}. Publique como INTERNO ou remova a coluna.`);
      dropped.push({ column: col, motivo: internal.get(lc) });
      continue;
    }
    if (!usada) {
      dropped.push({ column: col, motivo: 'nenhuma query usa' });
      continue;
    }
    kept.push(col);
  }
  if (publico) {
    const aceitas = new Set((cfg.allow || []).map((c) => String(c).toLowerCase()));
    const suspeitas = kept.filter((c) => looksPersonal(c) && !internal.has(c.toLowerCase()) && !aceitas.has(c.toLowerCase()));
    if (suspeitas.length)
      warnings.push(
        `${name}: coluna(s) com cara de dado pessoal indo para o pacote público: ${suspeitas.join(', ')} — declare pii no catálogo, publish.${name}.exclude, ou publish.${name}.allow se for público de propósito`,
      );
  }
  // `select count(*) from fonte` não cita coluna: leva a primeira, só para contar.
  if (!kept.length && columns.length) {
    const primeira = columns.find((c) => !excluded.has(c.toLowerCase()) && !(publico && internal.has(c.toLowerCase())));
    if (primeira) {
      kept.push(primeira);
      const i = dropped.findIndex((d) => d.column === primeira);
      if (i >= 0) dropped.splice(i, 1);
    }
  }
  const where = cfg.where ? String(cfg.where).trim() : '';
  if (!where) warnings.push(`${name}: sem publish.${name}.where — todas as linhas da fonte vão para o pacote`);
  return { select: kept, where, kept, dropped, star, warnings, errors };
}

/** Identificador SQL entre aspas duplas. */
export function quoteIdent(c) {
  return '"' + String(c).replace(/"/g, '""') + '"';
}
