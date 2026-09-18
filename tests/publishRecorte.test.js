import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { scopePredicate } from '../server/publish/app.js';

// O ☁ de uma página parametrizada exportava `SELECT *`: o app de UMA unidade
// levava o parquet de TODAS. Não era invasão — quem tinha acesso legítimo ao
// recorte baixava o arquivo inteiro que estava ao lado do app.html.
//
// O predicado que recorta é DERIVADO do que já estava no marcador: o filtro
// injetado pelo compilador na página parametrizada carrega {dim, level}, e o
// catálogo converte isso na expressão sobre o fato.
const PAGINA = path.join('projects', 'exemplo', 'pages', 'unidade', '[unidade].md');
const md = fs.readFileSync(PAGINA, 'utf8');

describe('predicado de recorte por valor do parâmetro', () => {
  it('deriva a expressão do fato a partir do marcador + catálogo', () => {
    const r = scopePredicate('exemplo', md, 'unidade', 'Batel');
    expect(r).toBeTruthy();
    expect(r.fato).toBe('comissoes');
    expect(r.dim).toBe('unidade');
    expect(r.sql).toBe(`cast("unidade" as varchar) = 'Batel'`);
  });

  it('aspas no valor são escapadas — o valor vem de fora', () => {
    const r = scopePredicate('exemplo', md, 'unidade', "O'Hara'; drop table comissoes; --");
    expect(r.sql).toBe(`cast("unidade" as varchar) = 'O''Hara''; drop table comissoes; --'`);
    // uma aspa solta fecharia o literal; duplicadas, não
    expect((r.sql.match(/'/g) || []).length % 2).toBe(0);
  });

  it('sem valor não há recorte (publicar tudo continua possível, mas explícito)', () => {
    expect(scopePredicate('exemplo', md, 'unidade', undefined)).toBeNull();
    expect(scopePredicate('exemplo', md, 'unidade', null)).toBeNull();
  });

  it('página SEM o filtro do parâmetro não produz predicado', () => {
    const outra = fs.readFileSync(path.join('projects', 'exemplo', 'pages', 'painel_rede.md'), 'utf8');
    expect(scopePredicate('exemplo', outra, 'unidade', 'Batel')).toBeNull();
  });

  it('parâmetro com nome diferente do filtro injetado não casa', () => {
    expect(scopePredicate('exemplo', md, 'inexistente', 'Batel')).toBeNull();
  });

  // Nível temporal: a expressão não é a coluna crua, é a derivação do nível —
  // é o mesmo motivo pelo qual parameter.level passou a ser obrigatório.
  it('dimensão com nível usa a expressão do NÍVEL, não a coluna', () => {
    const comNivel = md.replace('"filters":[{"dim":"unidade","values":["${params.unidade}"]', '"filters":[{"dim":"tempo","level":"ano","values":["${params.unidade}"]');
    const r = scopePredicate('exemplo', comNivel, 'unidade', '2025');
    expect(r).toBeTruthy();
    expect(r.sql).toBe(`cast(year(cast("data" as date)) as varchar) = '2025'`);
  });
});
