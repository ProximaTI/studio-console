import { describe, it, expect } from 'vitest';
import { buildTreemapOption, buildSankeyOption, SANKEY_SEP } from '../shared/chartOption.js';
import { styleById, compileViewblock } from '../shared/viewStyles.js';

// Dois dos três formatos de entrada que faltavam no registro (§5 da
// SPEC_escolha_de_grafico): hierarquia parte-de-um-todo e fluxo. Os dois
// consomem a MESMA tabela de contingência dos outros estilos — nenhum SQL novo.
const SOURCE = { name: 'f', columns: [{ name: 'regiao', type: 'VARCHAR' }, { name: 'servico', type: 'VARCHAR' }] };
const rows = [
  { regiao: 'Sul', servico: 'Corte', v: 10 },
  { regiao: 'Sul', servico: 'Escova', v: 5 },
  { regiao: 'Sudeste', servico: 'Corte', v: 20 },
];
const tree = (attrs, rs = rows) =>
  buildTreemapOption({ rows: rs, attrs: { x: 'regiao', y: 'v', ...attrs }, palette: ['#a63d5f'], dark: false });
const sank = (rs = rows) =>
  buildSankeyOption({ rows: rs, attrs: { x: 'regiao', inner: 'servico', y: 'v' }, palette: ['#a63d5f'], dark: false });

describe('treemap: composição', () => {
  it('uma dimensão vira lista plana; duas, aninhamento', () => {
    expect(tree({}).series[0].data.map((d) => d.name)).toEqual(['Sul', 'Sul', 'Sudeste']);
    const d2 = tree({ inner: 'servico' }).series[0].data;
    expect(d2.map((d) => d.name)).toEqual(['Sul', 'Sudeste']);
    expect(d2[0].children.map((c) => c.name)).toEqual(['Corte', 'Escova']);
  });

  // Área não representa sinal: um retângulo de −10 desenhado do tamanho de um de
  // +10 é mentira gráfica. Por isso o `breaks` manda usar barra nesse caso.
  it('valor negativo ou não numérico SOME, em vez de virar área', () => {
    const sujo = [...rows, { regiao: 'Norte', servico: 'X', v: -7 }, { regiao: 'Centro', servico: 'Y', v: 'muito' }];
    const nomes = tree({}, sujo).series[0].data.map((d) => d.name);
    expect(nomes).not.toContain('Norte');
    expect(nomes).not.toContain('Centro');
  });

  // Num relatório, navegação por clique é estado escondido: quem lê o snapshot
  // impresso não vê o mesmo que quem clicou.
  it('não navega ao clique nem mostra trilha', () => {
    const s = tree({ inner: 'servico' }).series[0];
    expect(s.nodeClick).toBe(false);
    expect(s.breadcrumb.show).toBe(false);
  });
});

describe('sankey: fluxo', () => {
  it('a ORDEM das dimensões é o papel: 1ª origem, 2ª destino', () => {
    const s = sank().series[0];
    expect(s.links).toHaveLength(3);
    expect(s.links[0].source.endsWith('Sul')).toBe(true);
    expect(s.links[0].target.endsWith('Corte')).toBe(true);
  });

  // O sankey do ECharts exige GRAFO ACÍCLICO: um valor presente na origem E no
  // destino fecharia ciclo e quebraria o gráfico inteiro. A identidade do nó
  // carrega o lado; o rótulo mostra só o nome.
  it('o mesmo valor nos dois lados não fecha ciclo', () => {
    const comCiclo = [...rows, { regiao: 'Corte', servico: 'Corte', v: 3 }];
    const s = sank(comCiclo).series[0];
    const ids = s.data.map((n) => n.name);
    expect(ids).toContain('0' + SANKEY_SEP + 'Corte');
    expect(ids).toContain('1' + SANKEY_SEP + 'Corte');
    // nenhum link sai e chega no MESMO id
    for (const l of s.links) expect(l.source).not.toBe(l.target);
  });

  it('o rótulo esconde a marca de lado', () => {
    const s = sank().series[0];
    expect(s.label.formatter({ name: '0' + SANKEY_SEP + 'Sul' })).toBe('Sul');
  });

  it('fluxo sem valor positivo não vira fita nem ocupa nó', () => {
    const s = sank([{ regiao: 'A', servico: 'B', v: 0 }, { regiao: 'C', servico: 'D', v: -1 }, { regiao: '', servico: 'E', v: 5 }]).series[0];
    expect(s.links).toHaveLength(0);
    expect(s.data).toHaveLength(0);
  });
});

describe('contratos no registro', () => {
  const vb = (style, dims, metrics) => ({
    v: 1,
    id: 'vb_t',
    source: { kind: 'semantic', name: 'm' },
    queries: [{ name: 'vb_t', sql: null }],
    dims,
    metrics,
    params: [],
    style,
    children: [],
  });
  const d = (n) => ({ dim: n, alias: n, column: n });
  const m = (n, fmt) => ({ name: n, alias: n, ...(fmt ? { fmt } : {}) });

  it('treemap aceita 1 ou 2 dimensões, nunca 3, e exatamente 1 métrica', () => {
    const s = styleById('graph.treemap');
    expect(s.requires(vb('graph.treemap', [d('regiao')], [m('v')]), SOURCE).ok).toBe(true);
    expect(s.requires(vb('graph.treemap', [d('regiao'), d('servico')], [m('v')]), SOURCE).ok).toBe(true);
    expect(s.requires(vb('graph.treemap', [d('a'), d('b'), d('c')], [m('v')]), SOURCE).ok).toBe(false);
    expect(s.requires(vb('graph.treemap', [d('regiao')], [m('v'), m('w')]), SOURCE).ok).toBe(false);
  });

  it('sankey exige DUAS dimensões — e o motivo está no texto do erro', () => {
    const s = styleById('graph.sankey');
    expect(s.requires(vb('graph.sankey', [d('a'), d('b')], [m('v')]), SOURCE).ok).toBe(true);
    const r = s.requires(vb('graph.sankey', [d('a')], [m('v')]), SOURCE);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ORIGEM · DESTINO/);
  });

  it('compilam para as tags esperadas, com o fmt da métrica', () => {
    const t = vb('graph.treemap', [d('regiao'), d('servico')], [m('v', 'brl')]);
    expect(compileViewblock(t, { vb: t, source: SOURCE, baseSql: 'select 1' })).toContain(
      '<Treemap data={vb_t} x=regiao inner=servico y=v yFmt=brl/>'
    );
    const k = vb('graph.sankey', [d('regiao'), d('servico')], [m('v', 'num0')]);
    expect(compileViewblock(k, { vb: k, source: SOURCE, baseSql: 'select 1' })).toContain(
      '<SankeyDiagram data={vb_t} x=regiao inner=servico y=v yFmt=num0/>'
    );
  });

  // Ganho colateral previsto: com o treemap no registro, "> ~40 categorias"
  // deixa de mandar sempre para a tabela quando a pergunta é composição.
  it('o break de muitas categorias do graph.bar ganhou destino gráfico', () => {
    const usos = styleById('graph.bar').breaks.map((b) => b.use);
    expect(usos).toContain('graph.treemap');
  });
});
