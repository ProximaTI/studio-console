import { describe, it, expect } from 'vitest';
import { STYLES, compileViewblock } from '../shared/viewStyles.js';
import { lintEvidenceCompat } from '../shared/evidenceLint.js';

// `RangeChart` foi criado com o estilo graph.range e NUNCA registrado em
// shared/evidenceLint.js — apesar do comentário no arquivo pedindo "manter em
// sincronia ao adicionar componentes". Resultado: toda página com marca de
// intervalo saía com erro `unknown-component` no badge do editor, e ninguém
// percebeu porque nenhum teste ligava o registro de estilos ao linter.
//
// Este teste liga os dois: TODO componente que qualquer estilo emite precisa ser
// conhecido pelo linter. Estilo novo com componente novo quebra aqui.

const SOURCE = {
  name: 'f',
  columns: [
    { name: 'unidade', type: 'VARCHAR' },
    { name: 'servico', type: 'VARCHAR' },
    { name: 'ano', type: 'BIGINT' },
    { name: 'uf', type: 'VARCHAR' },
    { name: 'origem', type: 'VARCHAR' },
    { name: 'destino', type: 'VARCHAR' },
    { name: 'olat', type: 'DOUBLE' },
    { name: 'olon', type: 'DOUBLE' },
    { name: 'dlat', type: 'DOUBLE' },
    { name: 'dlon', type: 'DOUBLE' },
  ],
};
const d = (c) => ({ dim: c, alias: c, column: c, table: 'f' });
const m = (a) => ({ name: a, alias: a, column: a, label: a });

// Uma seleção MÍNIMA VÁLIDA por estilo — se um estilo novo entrar sem fixture,
// o teste de cobertura abaixo acusa.
const FIXTURES = {
  tabular: { dims: [d('unidade')], metrics: [m('v')] },
  'graph.bar': { dims: [d('unidade')], metrics: [m('v')] },
  'graph.line': { dims: [d('ano')], metrics: [m('v')] },
  'graph.bubble': { dims: [d('unidade')], metrics: [m('x'), m('y')] },
  group: { dims: [d('unidade'), d('servico')], metrics: [m('v')] },
  freeform: { dims: [], metrics: [m('v')] },
  areamap: { dims: [d('uf')], metrics: [m('v')] },
  'graph.range': { dims: [d('unidade')], metrics: [m('lo'), m('mid'), m('hi')] },
  'graph.bump': { dims: [d('ano'), d('unidade')], metrics: [m('pos')] },
  'graph.histogram': { dims: [], metrics: [m('v')] },
  nested: {
    dims: [d('unidade'), d('servico')],
    metrics: [m('v')],
    nested: { parent: ['unidade'], child: ['servico'], childStyle: 'graph.bar', limitPerGroup: 6, maxGroups: 12 },
  },
  pivot: {
    dims: [d('unidade'), d('servico')],
    metrics: [m('v')],
    pivot: { rows: ['unidade'], cols: 'servico', measure: 'v', frozenCols: ['Corte', 'Escova'] },
  },
  connectionmap: {
    dims: [],
    metrics: [],
    roles: { fromName: 'origem', fromLat: 'olat', fromLon: 'olon', toName: 'destino', toLat: 'dlat', toLon: 'dlon' },
  },
  collabgraph: { dims: [], metrics: [], roles: { source: 'origem', target: 'destino' } },
};

const vbDe = (id) => ({
  v: 1,
  id: 'vb_x',
  source: { kind: 'semantic', name: 'f' },
  queries: [{ name: 'vb_x', sql: null }, { name: 'vb_x_2', sql: null }],
  params: [],
  style: id,
  children: [],
  ...FIXTURES[id],
});

describe('todo componente emitido pelos estilos é conhecido pelo linter', () => {
  it('existe fixture para cada estilo do registro', () => {
    expect(STYLES.map((s) => s.id).filter((id) => !FIXTURES[id])).toEqual([]);
  });

  for (const s of STYLES) {
    it(`${s.id} não emite componente desconhecido`, () => {
      const vb = vbDe(s.id);
      const out = compileViewblock(vb, { vb, source: SOURCE, baseSql: 'select 1' });
      const desconhecidos = lintEvidenceCompat('# t\n\n' + out + '\n').filter((f) => f.code === 'unknown-component');
      expect(desconhecidos, JSON.stringify(desconhecidos)).toEqual([]);
    });
  }

  // A regressão específica: RangeChart existe e é reconhecido como custom da
  // console (aviso de portabilidade), não como componente inexistente (erro).
  it('RangeChart é custom da console, não desconhecido', () => {
    const f = lintEvidenceCompat('# t\n\n<RangeChart data={q} x=a low=b mid=c high=d/>\n');
    expect(f).toHaveLength(1);
    expect(f[0].code).toBe('custom-component');
    expect(f[0].level).toBe('warn');
    expect(f[0].message).toMatch(/BoxPlot/); // diz qual é o equivalente no Evidence
  });
});
