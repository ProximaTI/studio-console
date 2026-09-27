// Servidor estático dos pacotes publicados (server/publish/serve.js): o que vai
// para o servidor público atrás do proxy. Só arquivos, só GET/HEAD, com Range.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler, parseRange, resolveInside } from '../server/publish/serve.js';
import { appConnectOrigins } from '../server/publish/app.js';

let dir;
let server;
let base;
const bytes = Buffer.from('0123456789abcdef');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-static-'));
  fs.mkdirSync(path.join(dir, 'proj', 'painel-app', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'proj', 'duckdb'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proj', 'painel-app', 'app.html'), '<!doctype html><p>ok</p>');
  fs.writeFileSync(path.join(dir, 'proj', 'painel-app', 'data', 'fato.parquet'), bytes);
  fs.writeFileSync(path.join(dir, 'proj', 'duckdb', 'duckdb-eh.wasm'), 'wasm');
  fs.writeFileSync(path.join(dir, 'proj', '.secrets.json'), '{"x":1}');
  server = http.createServer(createStaticHandler({ dir, prefix: '/paineis' })).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (p, headers = {}) => fetch(base + p, { headers });

describe('servidor estático', () => {
  it('serve o app com cabeçalhos de segurança', async () => {
    const r = await get('/paineis/proj/painel-app/app.html');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    const csp = r.headers.get('content-security-policy');
    expect(csp).toMatch(/frame-ancestors 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/'wasm-unsafe-eval'/);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('pasta do app serve o app.html; .wasm sai como application/wasm', async () => {
    expect(await (await get('/paineis/proj/painel-app/')).text()).toContain('<p>ok</p>');
    expect((await get('/paineis/proj/duckdb/duckdb-eh.wasm')).headers.get('content-type')).toBe('application/wasm');
  });

  it('Range devolve 206 com o pedaço certo; fora do arquivo → 416', async () => {
    const r = await get('/paineis/proj/painel-app/data/fato.parquet', { Range: 'bytes=4-7' });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 4-7/16');
    expect(await r.text()).toBe('4567');
    const suf = await get('/paineis/proj/painel-app/data/fato.parquet', { Range: 'bytes=-3' });
    expect(await suf.text()).toBe('def');
    expect((await get('/paineis/proj/painel-app/data/fato.parquet', { Range: 'bytes=99-' })).status).toBe(416);
  });

  it('ETag: requisição condicional → 304', async () => {
    const r = await get('/paineis/proj/painel-app/data/fato.parquet');
    const etag = r.headers.get('etag');
    expect(etag).toBeTruthy();
    expect((await get('/paineis/proj/painel-app/data/fato.parquet', { 'If-None-Match': etag })).status).toBe(304);
  });

  it('só GET/HEAD; nada de /api; nada fora do prefixo', async () => {
    const post = await fetch(base + '/paineis/proj/painel-app/app.html', { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    const head = await fetch(base + '/paineis/proj/painel-app/app.html', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect((await get('/api/query')).status).toBe(404);
    expect((await get('/paineis/api/query')).status).toBe(404);
    expect((await get('/proj/painel-app/app.html')).status).toBe(404);
  });

  it('sem fuga de pasta, sem arquivo oculto, sem listagem', async () => {
    expect((await get('/paineis/..%2F..%2Fetc/passwd')).status).toBe(400);
    expect((await get('/paineis/proj/.secrets.json')).status).toBe(400);
    expect((await get('/paineis/proj/')).status).toBe(404);
  });
});

describe('peças do servidor', () => {
  it('parseRange', () => {
    expect(parseRange('bytes=0-3', 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 });
    expect(parseRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange('bytes=10-', 10)).toEqual({ invalid: true });
    expect(parseRange('lixo', 10)).toBeNull();
  });

  it('resolveInside barra fuga e oculto', () => {
    expect(resolveInside('/r', 'a/b.html')).toBe(path.resolve('/r', 'a/b.html'));
    expect(resolveInside('/r', '../x')).toBeNull();
    expect(resolveInside('/r', 'a/.env')).toBeNull();
  });

  it('CSP do app: connect-src só com as origens remotas que ele usa', () => {
    expect(appConnectOrigins({ remote: false, dataBase: './data', sourceUrls: {} })).toEqual([]);
    expect(
      appConnectOrigins({
        remote: true,
        dataBase: 'https://bucket.exemplo.gov.br/paineis',
        sourceUrls: { a: 'https://s3.exemplo.org/x.parquet', b: 'https://bucket.exemplo.gov.br/y.parquet' },
      }),
    ).toEqual(['https://bucket.exemplo.gov.br', 'https://s3.exemplo.org']);
  });
});
