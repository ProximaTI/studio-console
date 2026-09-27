import { registerAllProjects } from './db.js';
import { createApp } from './app.js';
import { initToken, TOKEN_FILE } from './auth.js';

// API_PORT dedicada: PORT genérica pode vir do ambiente (ex.: harness de preview)
// apontando para a porta do Vite, o que colocaria a API no lugar errado.
const PORT = process.env.API_PORT || 3001;
// Só loopback: a API é administrativa (SQL, arquivos, segredos). Publicação para
// o público vai pelo servidor estático (server/static.js), nunca por aqui.
const HOST = process.env.API_HOST || '127.0.0.1';

const app = createApp({ token: initToken() });
registerAllProjects()
  .then(() =>
    app.listen(PORT, HOST, () => {
      console.log(`[studio-console] API em http://${HOST}:${PORT} (token em ${TOKEN_FILE})`);
      if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
        console.warn(`[studio-console] ATENÇÃO: API escutando em ${HOST} — fora do loopback.`);
      }
    }),
  )
  .catch((err) => {
    console.error('Erro ao iniciar DuckDB:', err);
    process.exit(1);
  });
