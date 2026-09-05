import { describe, it, expect } from 'vitest';
import { buildModel } from '../web/src/builder/infer';
import { buildSql } from '../web/src/builder/sqlgen';
import { EMPTY_SEL } from '../web/src/builder/types';
import type { Selections, SourceInfo } from '../web/src/builder/types';

const SOURCES: SourceInfo[] = [
  {
    name: 'vendas',
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'valor', type: 'DOUBLE' },
      { name: 'ano', type: 'INTEGER' },
      { name: 'regiao', type: 'VARCHAR' },
      { name: 'nome', type: 'VARCHAR' },
    ],
  },
  {
    name: 'produtos',
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'nome', type: 'VARCHAR' },
      { name: 'categoria', type: 'VARCHAR' },
    ],
  },
  {
    name: 'orcamentos',
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'ano', type: 'INTEGER' },
      { name: 'obs', type: 'VARCHAR' },
    ],
  },
];

const model = buildModel(SOURCES, 'vendas')!;
const sel = (p: Partial<Selections>): Selections => ({ ...EMPTY_SEL, ...p });

describe('buildSql (SQL determinístico)', () => {
  it('sem seleção: select * do fato com limit', () => {
    const sql = buildSql(model, EMPTY_SEL);
    expect(sql).toContain('select *');
    expect(sql).toContain('from "vendas" f');
    expect(sql).toContain('limit 100');
    expect(sql).not.toContain('left join');
  });

  it('só dimensões: SELECT DISTINCT com order by 1', () => {
    const sql = buildSql(model, sel({ groupBy: [{ table: 'vendas', column: 'regiao' }] }));
    expect(sql).toMatch(/^select distinct f\."regiao"/);
    expect(sql).toContain('order by 1');
  });

  it('agregação: alias <agg>_<col>, group by posicional, order pela 1ª agg desc', () => {
    const sql = buildSql(
      model,
      sel({
        groupBy: [{ table: 'vendas', column: 'regiao' }],
        measures: [{ column: 'valor', agg: 'sum' }],
      })
    );
    expect(sql).toContain('sum(f."valor") as "sum_valor"');
    expect(sql).toContain('group by 1');
    expect(sql).toContain('order by 2 desc');
  });

  it('join só entra quando a tabela é usada', () => {
    const soFato = buildSql(model, sel({ groupBy: [{ table: 'vendas', column: 'regiao' }] }));
    expect(soFato).not.toContain('left join');

    const comDim = buildSql(model, sel({ groupBy: [{ table: 'produtos', column: 'categoria' }] }));
    expect(comDim).toContain('left join "produtos" d1 on f."produto_id" = d1."produto_id"');
  });

  it('join composto inclui o ano quando o modelo inferiu (grão anual)', () => {
    const sql = buildSql(model, sel({ groupBy: [{ table: 'orcamentos', column: 'obs' }] }));
    expect(sql).toContain('f."produto_id" = d2."produto_id" and f."ano" = d2."ano"');
  });

  it('filtro numérico sem aspas; string com escape; múltiplos viram IN', () => {
    const sql = buildSql(
      model,
      sel({
        measures: [{ column: 'valor', agg: 'sum' }],
        filters: [
          { table: 'vendas', column: 'ano', values: ['2024'] },
          { table: 'vendas', column: 'regiao', values: ['Sul', "O'este"] },
        ],
      })
    );
    expect(sql).toContain('f."ano" = 2024');
    expect(sql).toContain(`f."regiao" in ('Sul', 'O''este')`);
  });

  it('colisão de nome entre fato e dimensão ganha alias prefixado', () => {
    const sql = buildSql(
      model,
      sel({
        groupBy: [
          { table: 'vendas', column: 'nome' },
          { table: 'produtos', column: 'nome' },
        ],
      })
    );
    expect(sql).toContain('d1."nome" as "produtos_nome"');
  });

  it('limit configurável e clampado em ≥ 1', () => {
    expect(buildSql(model, sel({ limit: 5 }))).toContain('limit 5');
    expect(buildSql(model, sel({ limit: 0 }))).toContain('limit 100');
  });

  it('todas as agregações suportadas', () => {
    for (const agg of ['sum', 'avg', 'count', 'min', 'max'] as const) {
      const sql = buildSql(model, sel({ measures: [{ column: 'valor', agg }] }));
      expect(sql).toContain(`${agg}(f."valor") as "${agg}_valor"`);
    }
  });
});
