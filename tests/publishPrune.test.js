// O pacote ☁ leva só o que a página usa (server/publish/prune.js) — auditoria
// de segurança 27/09/2026: antes era `SELECT *` de toda fonte citada.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { sqlAst, analyzeAst, planSource, internalColumns, parseableSql, looksPersonal } from '../server/publish/prune.js';
import { validatePublish } from '../server/projectConfig.js';
import { buildPublishedApp } from '../server/publish/app.js';
import { registerProjectSources, getConnection, PROJECTS_DIR } from '../server/db.js';

let conn;
beforeAll(async () => {
  conn = await (await DuckDBInstance.create(':memory:')).connect();
});

async function analisa(sql, fontes = ['fato', 'outra']) {
  const ast = await sqlAst(conn, sql);
  return ast ? analyzeAst(ast, fontes) : null;
}

describe('análise das queries pela AST do DuckDB', () => {
  it('colunas citadas, inclusive dentro de CTE, função, where e using', async () => {
    const a = await analisa(
      `with b as (select uf, sum("Valor") v from fato where year(cast(data as date)) = 2025 group by 1)
       select b.uf, v from b join outra using (regiao)`,
    );
    expect([...a.cols]).toEqual(expect.arrayContaining(['uf', 'valor', 'data', 'regiao', 'v']));
    expect(a.star.size).toBe(0);
  });

  it('select * sobre CTE não conta; direto sobre a fonte, com alias ou exclude, conta', async () => {
    expect((await analisa('with b as (select uf from fato) select * from b')).star.size).toBe(0);
    expect([...(await analisa('select * from fato')).star]).toEqual(['fato']);
    expect([...(await analisa('select f.* from fato f join outra o on o.k = f.k')).star]).toEqual(['fato']);
    expect([...(await analisa('select * exclude (x) from fato')).star]).toEqual(['fato']);
    expect((await analisa('select count(*) from fato')).star.size).toBe(0);
  });

  it('placeholders ${...} não impedem a análise', async () => {
    expect(parseableSql("where ano like '${inputs.ano.value}' and uf in (${inputs.uf})")).toBe("where ano like 'NULL' and uf in (NULL)");
    const a = await analisa("select uf from fato where ano = '${inputs.ano.value}' limit ${inputs.n}");
    expect([...a.cols]).toEqual(expect.arrayContaining(['uf', 'ano']));
  });

  it('SQL que o parser recusa devolve null (o chamador exporta tudo e avisa)', async () => {
    expect(await sqlAst(conn, 'selec uf fro fato')).toBeNull();
  });
});

describe('planSource', () => {
  const columns = ['uf', 'valor', 'cliente', 'orcid', 'extra'];
  const internal = new Map([['cliente', 'dimensão cliente (pii) do modelo m']]);
  const usa = (...cols) => [{ query: 'q1', cols: new Set(cols), star: new Set() }];

  it('leva só as usadas; internas e exclusões saem', () => {
    const p = planSource({ name: 'fato', columns, analyses: usa('uf', 'valor'), internal, cfg: { exclude: ['orcid'] } });
    expect(p.kept).toEqual(['uf', 'valor']);
    expect(p.dropped.map((d) => d.column)).toEqual(['cliente', 'orcid', 'extra']);
    expect(p.errors).toEqual([]);
  });

  it('coluna interna usada: recusa no público, passa no interno', () => {
    const pub = planSource({ name: 'fato', columns, analyses: usa('uf', 'cliente'), internal });
    expect(pub.errors[0]).toMatch(/PÚBLICO recusado.*q1.*fato\.cliente/);
    const int = planSource({ name: 'fato', columns, analyses: usa('uf', 'cliente'), internal, visibility: 'internal' });
    expect(int.errors).toEqual([]);
    expect(int.kept).toEqual(['uf', 'cliente']);
  });

  it('exclude usado por query é erro em qualquer visibilidade', () => {
    const p = planSource({ name: 'fato', columns, analyses: usa('orcid'), cfg: { exclude: ['orcid'] }, visibility: 'internal' });
    expect(p.errors[0]).toMatch(/exclude.*q1/);
  });

  it('star leva tudo (menos internas/excluídas) e avisa; nome pessoal avisa', () => {
    const p = planSource({ name: 'fato', columns, analyses: [{ query: 'q', cols: new Set(), star: new Set(['fato']) }], internal });
    expect(p.kept).toEqual(['uf', 'valor', 'orcid', 'extra']);
    expect(p.warnings.join('\n')).toMatch(/lê "\*"/);
    expect(p.warnings.join('\n')).toMatch(/dado pessoal.*orcid/);
  });

  it('allow declara coluna pessoal pública de propósito e cala o aviso', () => {
    const p = planSource({ name: 'fato', columns, analyses: usa('orcid'), cfg: { allow: ['ORCID'] } });
    expect(p.kept).toEqual(['orcid']);
    expect(p.warnings.join('\n')).not.toMatch(/dado pessoal/);
    expect(validatePublish({ fato: { allow: ['orcid'] } })).toEqual([]);
  });

  it('count(*) sem coluna leva a primeira; where declarado vai junto', () => {
    const p = planSource({ name: 'fato', columns, analyses: usa(), cfg: { where: 'uf = \'SP\'' } });
    expect(p.kept).toEqual(['uf']);
    expect(p.where).toBe("uf = 'SP'");
    expect(p.warnings.join('\n')).not.toMatch(/sem publish/);
  });

  it('looksPersonal: por palavra, sem confundir agregado com pessoa', () => {
    for (const c of ['orcid', 'autor_correspondente', 'codigo_pessoa', 'e_mail', 'author_name', 'author', 'cpf_cnpj', 'telefone'])
      expect(looksPersonal(c), c).toBe(true);
    for (const c of ['autorizado', 'massa_autoral', 'single_author_works', 'authors_per_doc_avg', 'tipo_pessoa', 'orgao', 'cargo'])
      expect(looksPersonal(c), c).toBe(false);
  });

  it('internalColumns lê expose: internal e pii do catálogo', () => {
    const m = internalColumns([
      {
        valid: true,
        model: 'm',
        catalog: {
          fact: 'Fato',
          dimensions: { cliente: { column: 'cliente_nome', pii: true }, uf: { column: 'uf' }, sec: { column: 's' } },
          policies: { sec: { expose: 'internal' } },
        },
      },
    ]);
    expect([...m.get('fato').keys()].sort()).toEqual(['cliente_nome', 's']);
  });
});

describe('validatePublish (project.yaml)', () => {
  it('aceita where e exclude; recusa o resto', () => {
    expect(validatePublish({ a: { where: 'x > 1', exclude: ['c'] } })).toEqual([]);
    expect(validatePublish({ a: { where: 'x > 1; drop table y' } })[0].path).toBe('publish.a.where');
    expect(validatePublish({ a: { colunas: ['c'] } })[0].path).toBe('publish.a.colunas');
    expect(validatePublish({ a: { exclude: 'c' } })[0].path).toBe('publish.a.exclude');
    expect(validatePublish(['x'])[0].path).toBe('publish');
  });
});

describe('buildPublishedApp no projeto exemplo', () => {
  let tmp;
  beforeAll(async () => {
    await registerProjectSources('exemplo', path.join(PROJECTS_DIR, 'exemplo', 'sources'));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-prune-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const pagesDir = path.join(PROJECTS_DIR, 'exemplo', 'pages');
  const colunasDo = async (file) => {
    const c = await getConnection('exemplo');
    const r = await c.runAndReadAll(`select name from parquet_schema('${file.replace(/\\/g, '/')}') where num_children is null`);
    return r.getRows().map((x) => String(x[0]));
  };

  it('painel_rede: o parquet leva só colunas usadas, sem cliente', async () => {
    const md = fs.readFileSync(path.join(pagesDir, 'painel_rede.md'), 'utf8');
    const out = path.join(tmp, 'exemplo', 'painel_rede-app');
    fs.mkdirSync(out, { recursive: true });
    const r = await buildPublishedApp('exemplo', 'painel_rede.md', md, {}, '', out, null, pagesDir);
    const cols = await colunasDo(path.join(out, 'data', 'comissoes.parquet'));
    expect(cols).not.toContain('cliente');
    expect(cols.length).toBeLessThan(12);
    const e = r.escopo.find((x) => x.source === 'comissoes');
    expect(e.colunas).toEqual(cols);
    expect(e.removidas.map((d) => d.column)).toContain('cliente');
    expect(fs.readFileSync(path.join(out, 'app.html'), 'utf8')).toMatch(/http-equiv="Content-Security-Policy"/);
  });

  it('página que usa cliente: pública recusada, interna publica', async () => {
    const md = '```sql q\nselect cliente, sum(valor) as v from comissoes group by 1\n```\n\n<DataTable data={q}/>\n';
    const out = path.join(tmp, 'exemplo', 'cli-app');
    fs.mkdirSync(out, { recursive: true });
    await expect(buildPublishedApp('exemplo', 'cli.md', md, {}, '', out, null, pagesDir)).rejects.toThrow(/PÚBLICO recusado.*cliente/);
    const r = await buildPublishedApp('exemplo', 'cli.md', md, {}, '', out, null, pagesDir, undefined, { visibility: 'internal' });
    expect(await colunasDo(path.join(out, 'data', 'comissoes.parquet'))).toEqual(['valor', 'cliente']);
    expect(r.escopo[0].linhas).toBeGreaterThan(0);
  });
});
