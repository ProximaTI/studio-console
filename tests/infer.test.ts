import { describe, it, expect } from 'vitest';
import { buildModel, modelSummary } from '../web/src/builder/infer';
import type { SourceInfo } from '../web/src/builder/types';

// Fixture no formato de GET /api/connectors.
const SOURCES: SourceInfo[] = [
  {
    name: 'vendas', // fato
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'cliente_id', type: 'VARCHAR' },
      { name: 'valor', type: 'DOUBLE' },
      { name: 'qtd', type: 'BIGINT' },
      { name: 'ano', type: 'INTEGER' },
      { name: 'regiao', type: 'VARCHAR' },
      { name: 'nome', type: 'VARCHAR' },
    ],
  },
  {
    name: 'produtos', // Regra B: chave produto_id compartilhada
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'nome', type: 'VARCHAR' },
      { name: 'categoria', type: 'VARCHAR' },
      { name: 'preco', type: 'DOUBLE' },
    ],
  },
  {
    name: 'orcamentos', // chave + ano nas duas → ano ENTRA no join
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'ano', type: 'INTEGER' },
      { name: 'obs', type: 'VARCHAR' },
    ],
  },
  {
    name: 'clientes', // Regra A: fato tem cliente_id → tabela clientes com id
    columns: [
      { name: 'id', type: 'VARCHAR' },
      { name: 'cidade', type: 'VARCHAR' },
    ],
  },
  {
    name: 'metas', // só compartilha ano (não é chave) → SEM edge
    columns: [
      { name: 'ano', type: 'INTEGER' },
      { name: 'meta', type: 'DOUBLE' },
    ],
  },
  {
    name: 'semattrs', // chave compartilhada mas nenhum atributo exibível → descartada
    columns: [
      { name: 'produto_id', type: 'VARCHAR' },
      { name: 'total', type: 'DOUBLE' },
    ],
  },
];

describe('buildModel (auto-inferência)', () => {
  const model = buildModel(SOURCES, 'vendas')!;

  it('medidas = numéricas do fato, excluindo chaves e ano', () => {
    expect(model.measures.map((c) => c.name)).toEqual(['valor', 'qtd']);
  });

  it('dimensões inferidas: produtos, orcamentos, clientes — sem metas nem semattrs', () => {
    expect(model.related.map((r) => r.table)).toEqual(['produtos', 'orcamentos', 'clientes']);
  });

  it('Regra B: join por chave de mesmo nome', () => {
    const p = model.related.find((r) => r.table === 'produtos')!;
    expect(p.join.on).toEqual([{ factCol: 'produto_id', dimCol: 'produto_id' }]);
  });

  it('ano entra no join quando as DUAS tabelas têm coluna de ano (grão anual)', () => {
    const o = model.related.find((r) => r.table === 'orcamentos')!;
    expect(o.join.on).toEqual([
      { factCol: 'produto_id', dimCol: 'produto_id' },
      { factCol: 'ano', dimCol: 'ano' },
    ]);
  });

  it('Regra A (convenção FK): cliente_id → clientes.id', () => {
    const c = model.related.find((r) => r.table === 'clientes')!;
    expect(c.join.on).toEqual([{ factCol: 'cliente_id', dimCol: 'id' }]);
  });

  it('atributos da dimensão excluem numéricas e colunas de join', () => {
    const p = model.related.find((r) => r.table === 'produtos')!;
    expect(p.attrs.map((c) => c.name)).toEqual(['nome', 'categoria']);
  });

  it('fato inexistente retorna null', () => {
    expect(buildModel(SOURCES, 'nao_existe')).toBeNull();
  });

  it('modelSummary tem o shape enviado ao agente', () => {
    const s = modelSummary(model);
    expect(s.fact.table).toBe('vendas');
    expect(s.fact.measures).toEqual(['valor', 'qtd']);
    expect(s.dimensions.find((d) => d.table === 'orcamentos')!.join).toEqual(['produto_id', 'ano']);
  });
});
