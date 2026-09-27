// Provas da auditoria de segurança (27/09/2026) viradas teste de aceitação:
// cada requisição que o relatório conseguiu executar precisa falhar aqui.
// O app sobe em porta efêmera (sem registrar projetos) e é exercitado por HTTP.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { PROJECTS_DIR } from '../server/db.js';
import { publicSettings, mergeSettingsUpdate } from '../server/settings.js';
import { hostName } from '../server/auth.js';

const TOKEN = 'token-de-teste';
let server;
let base;

beforeAll(async () => {
  server = createApp({ token: TOKEN }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server?.close());

const auth = { 'x-studio-token': TOKEN };
const get = (p, headers = {}) => fetch(base + p, { headers });
const postJson = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

describe('API administrativa exige token', () => {
  it('GETs administrativos sem token → 401', async () => {
    for (const p of ['/api/projects', '/api/settings', '/api/connections']) {
      expect((await get(p)).status, p).toBe(401);
    }
  });

  it('POST /api/query sem token → 401 (a prova do read_text)', async () => {
    const r = await postJson(
      '/api/query',
      JSON.stringify({ project: 'scratch', sql: "SELECT content FROM read_text('C:/qualquer/arquivo.txt')" }),
    );
    expect(r.status).toBe(401);
  });

  it('token errado → 401; health segue aberto', async () => {
    expect((await get('/api/projects', { 'x-studio-token': 'outro' })).status).toBe(401);
    expect((await get('/api/health')).status).toBe(200);
  });

  it('Host fora do loopback → 403 (DNS rebinding)', async () => {
    const status = await new Promise((resolve, reject) => {
      const { port } = server.address();
      http
        .get({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('hostName tira a porta, inclusive de IPv6', () => {
    expect(hostName('localhost:5173')).toBe('localhost');
    expect(hostName('[::1]:3001')).toBe('[::1]');
    expect(hostName('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('CORS, erros e caminhos', () => {
  it('nenhuma resposta libera origem externa', async () => {
    const r = await get('/api/health', { Origin: 'https://audit.invalid' });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(base + '/api/query', {
      method: 'OPTIONS',
      headers: { Origin: 'https://audit.invalid', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('JSON inválido → 400 curto, sem stack nem caminho', async () => {
    const r = await postJson('/api/query', '{', auth);
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(JSON.parse(text).error).toMatch(/JSON inválido/);
    expect(text).not.toMatch(/node_modules|[A-Z]:[\\/]|\bat \w/);
  });

  it('%2F no nome do projeto ou da página → 400', async () => {
    expect((await get('/api/projects/..%2F..%2Fserver/files', auth)).status).toBe(400);
    expect((await get('/api/projects/APC/app/..%2F..%2F..%2Fserver/index.js', auth)).status).toBe(400);
  });

  it('rota desconhecida → 404 JSON', async () => {
    const r = await get('/api/nada', auth);
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBeTruthy();
  });
});

describe('upload aceita só formatos de dado', () => {
  it('.sql é recusado e nada é gravado', async () => {
    const project = 'zz_teste_seguranca_upload';
    const dir = path.join(PROJECTS_DIR, project);
    const fd = new FormData();
    fd.append('file', new Blob(['select 1']), 'malicioso.sql');
    const r = await fetch(`${base}/api/projects/${project}/sources/upload`, { method: 'POST', headers: auth, body: fd });
    try {
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/não aceito/);
      expect(fs.existsSync(path.join(dir, 'sources', 'malicioso.sql'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('settings não devolvem a chave de API', () => {
  const gravado = { ai: { provider: 'anthropic', apiKey: 'sk-segredo', baseUrl: 'x' } };

  it('publicSettings troca a chave por hasApiKey', () => {
    const out = publicSettings(gravado);
    expect(out.ai.apiKey).toBe('');
    expect(out.ai.hasApiKey).toBe(true);
    expect(JSON.stringify(out)).not.toContain('sk-segredo');
    expect(gravado.ai.apiKey).toBe('sk-segredo'); // não muta
  });

  it('chave vazia preserva a gravada; nova substitui; clearApiKey remove', () => {
    expect(mergeSettingsUpdate({ ai: { provider: 'anthropic', apiKey: '', hasApiKey: true } }, gravado).ai).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-segredo',
    });
    expect(mergeSettingsUpdate({ ai: { apiKey: 'sk-nova' } }, gravado).ai.apiKey).toBe('sk-nova');
    expect(mergeSettingsUpdate({ ai: { apiKey: '', clearApiKey: true } }, gravado).ai).toEqual({ apiKey: '' });
  });
});
