import { describe, it, expect } from 'vitest';
import { validateProjectConfig } from '../server/projectConfig.js';

describe('project.yaml — validador anti-segredo (Fase Fontes §3)', () => {
  it('config limpa passa (connections referenciam segredo por nome)', () => {
    const yaml = [
      'deploy: { dir: published }',
      'connections:',
      '  dw_producao: { type: postgres, host: db.exemplo.com, database: vendas, credentials_ref: dw_producao }',
      'materialized:',
      '  espelho: { connection: dw_producao, query: "select * from vendas.pedidos", stale_after: 7d }',
      'mounts:',
      '  lake: { base_url: "s3://meu-bucket/studio", credentials_ref: lake_s3 }',
    ].join('\n');
    const { errors, config } = validateProjectConfig(yaml);
    expect(errors).toEqual([]);
    expect(config.connections.dw_producao.credentials_ref).toBe('dw_producao');
  });

  it('RECUSA connection string com senha, chave AWS e credencial inline', () => {
    const cs = validateProjectConfig('conn: "postgres://user:S3nh4@db:5432/vendas"');
    expect(cs.errors.some((e) => e.message.includes('connection string'))).toBe(true);
    const aws = validateProjectConfig('key: AKIAIOSFODNN7EXAMPLE');
    expect(aws.errors.some((e) => e.message.includes('AWS'))).toBe(true);
    const inline = validateProjectConfig('connections:\n  x: { password: "hunter22222" }');
    expect(inline.errors.some((e) => e.message.includes('credencial inline'))).toBe(true);
  });

  it('estrutura: connection sem credentials_ref, materialized órfã, mount sem base_url', () => {
    const yaml = [
      'connections:',
      '  a: { type: postgres }',
      'materialized:',
      '  v: { connection: inexistente }',
      'mounts:',
      '  m: { prefix: x }',
    ].join('\n');
    const { errors } = validateProjectConfig(yaml);
    const paths = errors.map((e) => e.path);
    expect(paths).toContain('connections.a.credentials_ref');
    expect(paths).toContain('materialized.v.connection');
    expect(paths).toContain('materialized.v.query');
    expect(paths).toContain('mounts.m.base_url');
  });
});
