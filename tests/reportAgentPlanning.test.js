// Agente de relatório com modelo local (qwen3-14b, 28/09/2026): o que era regra
// só no prompt virou gramática no schema, porque o modelo não seguia.
//   - "citações por região" saía como página parametrizada por região, e a
//     região ia para o mapa por UF;
//   - "uma página para cada região" estourava os 4096 tokens empilhando blocos.
import { describe, it, expect } from 'vitest';
import { wantsPagePerValue, wantsReference, planSchema, planSystemPrompt, catalogSummary, AGENT_LIMITS, REPORT_PLAN_SCHEMA } from '../server/routes/agent.js';
import { validateReportPlan } from '../shared/reportPlan.js';
import { isUfColumn } from '../shared/viewStyles.js';
import { loadCatalogs } from '../server/semantic.js';

const CAT = loadCatalogs('exemplo').find((m) => m.model === 'comissoes').catalog;

describe('wantsPagePerValue', () => {
  it('agrupamento "X por Y" não pede página por valor', () => {
    for (const p of ['relatório de somatório de citações por região', 'mapa das citações por UF', 'faturamento por unidade e evolução mensal'])
      expect(wantsPagePerValue(p), p).toBe(false);
  });
  it('"cada", "uma página por/para", "dossiê" pedem', () => {
    for (const p of ['uma página para cada região', 'dossiê de cada IES', 'Uma página por unidade', 'perfil individual das IES'])
      expect(wantsPagePerValue(p), p).toBe(true);
  });
});

describe('planSchema (gramática do agente)', () => {
  it('limita páginas e blocos, e fixa o formato do path', () => {
    const s = planSchema();
    expect(s.properties.pages.maxItems).toBe(AGENT_LIMITS.pages);
    const page = s.properties.pages.items;
    expect(page.properties.blocks.maxItems).toBe(AGENT_LIMITS.blocksPerPage);
    const re = new RegExp(page.properties.path.pattern);
    expect(re.test('[regiao].md')).toBe(true);
    expect(re.test('visao_geral.md')).toBe(true);
    expect(re.test('regioes/[regiao].md')).toBe(false);
  });
  it('sem pedido de página por valor, parameter nem existe', () => {
    const page = planSchema({ allowParameter: false }).properties.pages.items;
    expect(page.properties.parameter).toBeUndefined();
    expect(new RegExp(page.properties.path.pattern).test('[regiao].md')).toBe(false);
  });
  it('não muta o schema do contrato', () => {
    planSchema({ allowParameter: false });
    expect(REPORT_PLAN_SCHEMA.properties.pages.items.properties.parameter).toBeDefined();
    expect(REPORT_PLAN_SCHEMA.properties.pages.maxItems).toBeUndefined();
  });
});

describe('planSchema com catálogo: nomes como lista fechada', () => {
  const s = planSchema({ catalog: CAT, visibility: 'public' });
  const variantes = s.properties.pages.items.properties.blocks.items.anyOf;
  const bloco = variantes[0];
  const refDe = (v) => v.anyOf || [v];

  it('métricas só do catálogo', () => {
    expect(bloco.properties.metrics.items.enum.sort()).toEqual(Object.keys(CAT.metrics).sort());
  });

  it('dimensão com hierarquia aceita só os níveis dela; plana não tem level', () => {
    const dims = refDe(bloco.properties.dims.items);
    const tempo = dims.find((v) => v.properties.dim.const === 'tempo');
    expect(tempo.properties.level.enum).toEqual(CAT.dimensions.tempo.hierarchy);
    expect(tempo.required).toEqual(['dim']); // em dims o nível é opcional
    const planas = dims.find((v) => v.properties.dim.enum);
    expect(planas.properties.level).toBeUndefined();
    expect(planas.properties.dim.enum).toContain('unidade');
    expect(planas.properties.dim.enum).not.toContain('tempo.ano');
  });

  it('em filtro o nível é obrigatório (o validador exige) e "values" também', () => {
    const tempo = refDe(bloco.properties.filters.items).find((v) => v.properties.dim.const === 'tempo');
    expect(tempo.required).toEqual(['dim', 'level', 'values']);
  });

  it('argumento: "from" só nas formas válidas — tempo.ano sim, tempo sozinho não', () => {
    const froms = s.properties.globalParams.items.properties.from.enum;
    expect(froms).toContain('tempo.ano');
    expect(froms).toContain('unidade');
    expect(froms).not.toContain('tempo');
  });

  it('relatório público: dimensão interna/pii nem aparece; interno: aparece', () => {
    const nomes = (sc) => refDe(sc.properties.pages.items.properties.blocks.items.anyOf[0].properties.dims.items).flatMap((v) => v.properties.dim.enum || [v.properties.dim.const]);
    expect(nomes(s)).not.toContain('cliente');
    expect(nomes(planSchema({ catalog: CAT, visibility: 'internal' }))).toContain('cliente');
  });

  const varDe = (sc, estilo) => sc.properties.pages.items.properties.blocks.items.anyOf.find((v) => v.properties.style.enum.includes(estilo));

  it('cada estilo só com as opções dele (o 30b punha table e reference num mapa)', () => {
    const mapa = varDe(s, 'areamap');
    expect(mapa.properties.reference).toBeUndefined();
    expect(mapa.properties.table).toBeUndefined();
    expect(mapa.properties.orientation).toBeUndefined();
    expect(varDe(s, 'tabular').properties.table).toBeDefined();
    expect(varDe(s, 'graph.bar').properties.orientation).toBeDefined();
    expect(varDe(s, 'group').properties.stack).toBeDefined();
    expect(varDe(s, 'graph.line').properties.order).toBeUndefined(); // linha reordena pelo tempo
    expect(varDe(s, 'nested').properties.nested).toBeDefined();
    expect(varDe(s, 'graph.bar').properties.nested).toBeUndefined();
  });

  it('referência: só nos estilos que desenham linha, e só quando o pedido fala em meta/média/limite', () => {
    const comPedido = planSchema({ catalog: CAT, allowReference: true });
    expect(varDe(comPedido, 'graph.bar').properties.reference.items.properties.from).toBeDefined();
    expect(varDe(comPedido, 'graph.bubble').properties.reference.items.properties.from).toBeUndefined(); // bolha: só literal
    expect(varDe(comPedido, 'areamap').properties.reference).toBeUndefined();
    const semPedido = planSchema({ catalog: CAT, allowReference: false });
    expect(varDe(semPedido, 'graph.bar').properties.reference).toBeUndefined();
  });

  it('wantsReference', () => {
    expect(wantsReference('faturamento por unidade e evolução mensal')).toBe(false);
    expect(wantsReference('citações por região')).toBe(false);
    for (const p of ['barras com a meta de 80%', 'marcar a média mundial de FWCI', 'com linha de referência', 'acima do limite legal'])
      expect(wantsReference(p), p).toBe(true);
  });
});

describe('o agente sabe quais dimensões vão para o mapa', () => {
  it('catalogSummary marca mapa_uf pelo mesmo critério do validador', () => {
    const dims = catalogSummary(CAT).dimensions;
    expect(dims.uf.mapa_uf).toBe(true);
    expect(dims.regiao.mapa_uf).toBeUndefined();
    expect(isUfColumn('uf')).toBe(true);
    expect(isUfColumn('ies_sigla')).toBe(true);
    expect(isUfColumn('regiao')).toBe(false);
  });
  it('o prompt ensina agrupamento × página por valor conforme o pedido', () => {
    expect(planSystemPrompt(CAT, { allowParameter: false })).toMatch(/Todas as páginas são\s+comuns/);
    const com = planSystemPrompt(CAT, { allowParameter: true });
    expect(com).toMatch(/UMA PÁGINA POR VALOR/);
    expect(com).toMatch(/SÓ com a dimensão marcada mapa_uf/);
  });
});

describe('mensagens do validador dizem a saída (voltam ao agente na 2ª tentativa)', () => {
  const plano = (pagina) => ({ version: 1, title: 'T', purpose: 'p', visibility: 'public', catalog: 'comissoes', globalParams: [], pages: [pagina], warnings: [] });
  it('mapa com dimensão que não é UF sugere o fallback', () => {
    const errs = validateReportPlan(plano({ path: 'r.md', title: 'R', blocks: [{ metrics: ['faturamento'], dims: [{ dim: 'regiao' }], filters: [], style: 'areamap' }] }), { catalog: CAT });
    expect(errs.map((e) => e.message).join('\n')).toMatch(/use "graph\.bar"/);
  });
  it('parameter em página comum oferece remover o parameter', () => {
    const errs = validateReportPlan(
      plano({ path: 'r.md', title: 'R', parameter: { name: 'regiao', dimension: 'regiao' }, blocks: [{ metrics: ['faturamento'], dims: [{ dim: 'uf' }], filters: [], style: 'tabular' }] }),
      { catalog: CAT },
    );
    expect(errs.find((e) => e.path === 'pages[0].path').message).toMatch(/\[regiao\]\.md — ou.*remova parameter/);
  });
});
