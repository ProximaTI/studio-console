import { describe, it, expect } from 'vitest';
import { validateConnectionsText } from '../server/connections.js';

describe('connections.yaml global (DELTA §1)', () => {
  it('registro limpo passa (sem segredos: host/porta/db/usuário apenas)', () => {
    const yaml = [
      'dw_producao:',
      '  type: postgres',
      '  host: db.exemplo.com',
      '  port: 5432',
      '  database: vendas',
      '  user: leitura',
      'lake:',
      '  type: duckdb',
      '  path: data/lake.duckdb',
    ].join('\n');
    const { errors, connections } = validateConnectionsText(yaml);
    expect(errors).toEqual([]);
    expect(connections.dw_producao.host).toBe('db.exemplo.com');
  });

  it('RECUSA senha inline (o registro é versionável)', () => {
    const r = validateConnectionsText('x: { type: postgres, password: "hunter2222222" }');
    expect(r.errors.some((e) => e.message.includes('write-only'))).toBe(true);
  });

  it('valida tipo e path do duckdb', () => {
    const r = validateConnectionsText('a: { type: oracle }\nb: { type: duckdb }');
    expect(r.errors.some((e) => e.path === 'a.type')).toBe(true);
    expect(r.errors.some((e) => e.path === 'b.path')).toBe(true);
  });

});

describe('conexão s3/MinIO (object storage privado)', () => {
  it('aceita registro s3 completo (sem segredo — a chave vive no .secrets.json)', () => {
    const yaml = [
      'datalake:',
      '  type: s3',
      '  bucket: meu-bucket',
      '  prefix: caminho/do/dataset',
      '  endpoint: objstorage.exemplo.com',
      '  url_style: path',
      '  use_ssl: true',
    ].join('\n');
    const { errors, connections } = validateConnectionsText(yaml);
    expect(errors).toEqual([]);
    expect(connections.datalake.bucket).toBe('meu-bucket');
  });

  it('exige bucket e endpoint', () => {
    const r = validateConnectionsText('x: { type: s3 }');
    expect(r.errors.some((e) => e.path === 'x.bucket')).toBe(true);
    expect(r.errors.some((e) => e.path === 'x.endpoint')).toBe(true);
  });

  it('endpoint é HOST, não URL (o esquema vem de use_ssl)', () => {
    const r = validateConnectionsText('x: { type: s3, bucket: b, endpoint: "https://objstorage.exemplo.com" }');
    expect(r.errors.some((e) => e.path === 'x.endpoint' && /só o host/.test(e.message))).toBe(true);
  });

  it('url_style fechado em path|vhost e datasets é lista', () => {
    const r = validateConnectionsText('x: { type: s3, bucket: b, endpoint: h, url_style: dns, datasets: 7 }');
    expect(r.errors.some((e) => e.path === 'x.url_style')).toBe(true);
    expect(r.errors.some((e) => e.path === 'x.datasets')).toBe(true);
  });
});

describe('instância de extração com espaço para derramar', () => {
  it('cria com temp_directory — GROUP BY grande pagina para disco em vez de matar o processo', async () => {
    const { createExtractionInstance } = await import('../server/connections.js');
    const inst = await createExtractionInstance();
    const c = await inst.connect();
    try {
      const r = await c.runAndReadAll(`select current_setting('temp_directory') as t`);
      expect(String(r.getRowObjects()[0].t)).toMatch(/studio-duckdb-spill/);
    } finally {
      try { c.closeSync?.(); } catch { /* efêmera */ }
    }
  });
});
