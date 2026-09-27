// Servidor ESTÁTICO dos pacotes publicados (app.html + duckdb/ + data/).
//
// É o que vai para o servidor público — atrás do proxy do Joomla, por exemplo.
// Não carrega nada do console: sem Express, sem DuckDB, sem rotas /api, sem
// acesso a segredos. Só lê arquivos de uma pasta, por GET/HEAD.
//
//   npm run serve:published
//   STATIC_DIR=D:/deploy/published STATIC_PORT=4173 STATIC_HOST=0.0.0.0 \
//   STATIC_PREFIX=/paineis STATIC_FRAME_ANCESTORS="'self'" npm run serve:published
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from './publish/serve.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(ROOT, process.env.STATIC_DIR || 'published');
const port = Number(process.env.STATIC_PORT || 4173);
const host = process.env.STATIC_HOST || '127.0.0.1';
const prefix = process.env.STATIC_PREFIX || '/';
const frameAncestors = process.env.STATIC_FRAME_ANCESTORS || "'self'";

if (!fs.existsSync(dir)) {
  console.error(`[static] pasta não encontrada: ${dir}`);
  process.exit(1);
}

http
  .createServer(createStaticHandler({ dir, prefix, frameAncestors }))
  .listen(port, host, () => console.log(`[static] ${dir} em http://${host}:${port}${prefix === '/' ? '/' : prefix + '/'}`));
