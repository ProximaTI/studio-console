// Inventário dos pacotes publicados: o que cada app ENTREGA ao navegador.
//
//   npm run audit:published                 (pasta published/)
//   npm run audit:published -- D:/deploy/published
//
// Por Parquet: linhas, colunas, MB e colunas com cara de dado pessoal NÃO
// declaradas em publish.<fonte>.allow. Sai com código 1 se sobrar alguma — serve
// de aceite antes de copiar a pasta para o servidor público.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { looksPersonal } from '../server/publish/prune.js';
import { readProjectConfig } from '../server/projectConfig.js';

// Colunas declaradas públicas de propósito (publish.<fonte>.allow no project.yaml).
// O parquet de view de schema sai como <schema>__<tabela>; a chave é <schema>.<tabela>.
function aceitas(projeto, arquivo) {
  const fonte = arquivo.replace(/\.parquet$/, '').replace('__', '.');
  const cfg = readProjectConfig(projeto).publish?.[fonte] || {};
  return new Set((cfg.allow || []).map((c) => String(c).toLowerCase()));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(ROOT, process.argv[2] || 'published');
if (!fs.existsSync(dir)) {
  console.error(`pasta não encontrada: ${dir}`);
  process.exit(2);
}

const conn = await (await DuckDBInstance.create(':memory:')).connect();
const rows = [];
for (const proj of fs.readdirSync(dir).sort()) {
  const pd = path.join(dir, proj);
  if (!fs.statSync(pd).isDirectory()) continue;
  for (const app of fs.readdirSync(pd).filter((d) => d.endsWith('-app')).sort()) {
    const dd = path.join(pd, app, 'data');
    if (!fs.existsSync(dd)) continue;
    for (const f of fs.readdirSync(dd).filter((x) => x.endsWith('.parquet')).sort()) {
      const p = path.join(dd, f).replace(/\\/g, '/').replace(/'/g, "''");
      const n = await conn.runAndReadAll(`select count(*) from read_parquet('${p}')`);
      const c = await conn.runAndReadAll(`select name from parquet_schema('${p}') where num_children is null`);
      const cols = c.getRows().map((r) => String(r[0]));
      rows.push({
        projeto: proj,
        app,
        arquivo: f,
        linhas: Number(n.getRows()[0][0]),
        colunas: cols.length,
        mb: (fs.statSync(path.join(dd, f)).size / 1e6).toFixed(1),
        suspeitas: cols.filter((x) => looksPersonal(x) && !aceitas(proj, f).has(x.toLowerCase())),
      });
    }
  }
}

const head = ['projeto', 'app', 'arquivo', 'linhas', 'colunas', 'MB', 'suspeitas'];
console.log(head.join('\t'));
for (const r of rows) console.log([r.projeto, r.app, r.arquivo, r.linhas, r.colunas, r.mb, r.suspeitas.join(',')].join('\t'));
const ruins = rows.filter((r) => r.suspeitas.length);
console.log(`\n${rows.length} parquet(s) em ${new Set(rows.map((r) => r.projeto + '/' + r.app)).size} pacote(s); ${ruins.length} com coluna suspeita.`);
process.exit(ruins.length ? 1 : 0);
