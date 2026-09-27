import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Token da API: gerado pelo server a cada início (server/auth.js). Lido a cada
// requisição — o server reinicia com --watch e troca o token.
const TOKEN_FILE = process.env.STUDIO_TOKEN_FILE || path.join(root, 'server', '.runtime', 'token');
function apiToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    proxy: {
      '/api': {
        // 127.0.0.1 explícito: a API escuta só em IPv4 loopback.
        target: 'http://127.0.0.1:3001',
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            const t = apiToken();
            if (t) req.setHeader('x-studio-token', t);
          });
        },
      },
    },
    fs: {
      // Só o que o front precisa: o próprio web/, o módulo compartilhado e as
      // dependências (hoisted na raiz pelos workspaces). Antes era '..' — o
      // repositório inteiro, server/ incluído, servido por /@fs.
      allow: [here, path.join(root, 'shared'), path.join(root, 'node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.secrets.json', '**/connections.yaml', '**/settings.json', '**/.runtime/**'],
    },
  },
});
