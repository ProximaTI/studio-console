import { describe, it, expect } from 'vitest';
import { STYLES, styleById, styleMenuLines, compileViewblock } from '../shared/viewStyles.js';
import { PLANNABLE, planSystemPrompt, REPORT_PLAN_SCHEMA } from '../server/routes/agent.js';
import { BLOCK_OPTIONS } from '../shared/viewStyles.js';

// O menu do prompt do agente repetia à mão o que o registro já dizia em código,
// e toda frente nova exigia editar os dois. Estes testes existem para que a
// duplicação não volte: o prompt é DERIVADO do registro, não uma cópia dele.

describe('metadados de escolha no registro', () => {
  it('todo estilo planejável diz a PERGUNTA que responde', () => {
    for (const id of PLANNABLE) {
      const s = styleById(id);
      expect(s, id).toBeTruthy();
      expect(s.question, `${id} sem question`).toBeTruthy();
    }
  });

  it('nenhum breaks/fallback aponta para estilo inexistente', () => {
    for (const s of STYLES) {
      for (const b of s.breaks || []) expect(styleById(b.use), `${s.id}.breaks → ${b.use}`).toBeTruthy();
      if (s.fallback) expect(styleById(s.fallback), `${s.id}.fallback → ${s.fallback}`).toBeTruthy();
    }
  });

  it('nenhum estilo indica a si mesmo como saída', () => {
    for (const s of STYLES) {
      expect(s.fallback).not.toBe(s.id);
      for (const b of s.breaks || []) expect(b.use).not.toBe(s.id);
    }
  });

  // O par barplot/boxplot é o erro canônico de leitura: a barra pressupõe UM
  // valor por categoria e some com a dispersão quando há várias observações.
  it('as saídas que o produto aprendeu estão declaradas', () => {
    expect(styleById('graph.bar').breaks.map((b) => b.use)).toContain('graph.range');
    expect(styleById('graph.range').breaks.map((b) => b.use)).toContain('graph.histogram');
    expect(styleById('graph.line').breaks.map((b) => b.use)).toContain('nested');
    // choropleth de contagem absoluta colore população e área, não a taxa
    expect(styleById('areamap').breaks[0].quando).toMatch(/CONTAGEM ABSOLUTA/);
  });
});

describe('menu gerado', () => {
  const linhas = styleMenuLines(PLANNABLE);
  const texto = linhas.join('\n');
  // as linhas são quebradas em ~105 col; o que se afirma aqui é o CONTEÚDO
  const plano = texto.replace(/\s+/g, ' ');

  it('lista todo estilo planejável, e nenhum que não seja', () => {
    for (const id of PLANNABLE) expect(plano, id).toContain(`${styleById(id).question} `);
    for (const s of STYLES) if (!PLANNABLE.includes(s.id)) expect(plano).not.toContain(s.question);
  });

  // A propriedade ANTI-DRIFT: o contrato impresso no prompt é a MESMA string
  // que o compilador devolve ao recusar. Não dá para prometer uma coisa e
  // cobrar outra — é o mesmo objeto.
  it('o contrato impresso é o reason do próprio requires()', () => {
    const vazio = { dims: [], metrics: [], params: [], roles: {}, source: { kind: 'semantic' } };
    for (const id of PLANNABLE) {
      const r = styleById(id).requires(vazio, { name: '', columns: [] });
      if (!r.ok) expect(plano, id).toContain(`${id} ${r.reason}`.replace(/\s+/g, ' '));
    }
  });

  it('cada break aparece como "<estilo> quando … → use <saída>"', () => {
    for (const id of PLANNABLE)
      for (const b of styleById(id).breaks || [])
        expect(plano).toContain(`${id} quando ${b.quando} → use ${b.use}`.replace(/\s+/g, ' '));
  });

  // Medido em 4 execuções ao vivo: colapsar cardápio, contratos e ressalvas num
  // bloco indentado por estilo (tudo no mesmo peso) fez o planejador violar
  // contrato em 4/4 e parar de escolher graph.histogram. As três visões têm
  // trabalhos diferentes e precisam continuar separadas.
  it('sao TRES visoes distintas, nao um bloco so', () => {
    expect(texto).toContain('- ESCOLHA O ESTILO PELA PERGUNTA');
    expect(texto).toContain('- CONTRATOS (o compilador RECUSA');
    expect(texto).toContain('- NÃO use:');
    // o cardápio é uma linha por estilo, com o id no fim para varredura visual
    for (const id of PLANNABLE) expect(texto).toMatch(new RegExp(`\\.+ ${id.replace('.', '\\.')}$`, 'm'));
  });

  it('a config específica do estilo (planHint) entra quebrada em linhas legíveis', () => {
    expect(plano).toMatch(/NÃO acrescente p25\/mediana\/p75/);
    expect(plano).toMatch(/nested\.parent/);
    for (const l of linhas) expect(l.length, l).toBeLessThan(160);
  });
});

describe('o prompt do planejador é derivado, não copiado', () => {
  const CAT = { model: 'm', fact: 'f', dimensions: { uf: { column: 'uf' } }, metrics: { v: { column: 'v', agg: 'sum' } } };
  const prompt = planSystemPrompt(CAT, { audience: 'X', visibility: 'public' });

  it('contém o menu gerado, íntegro', () => {
    for (const l of styleMenuLines(PLANNABLE)) expect(prompt).toContain(l);
  });

  it('não sobrou nada escrito à mão sobre estilos', () => {
    // o parágrafo de contratos e os bullets de config antigos saíram do arquivo
    expect(prompt).not.toContain('- Contratos: graph.bar exige');
    expect(prompt).not.toContain('- nested (pequenos múltiplos):');
    expect(prompt).not.toContain('- graph.histogram (distribuição):');
    // e o menu aparece UMA vez só
    expect(prompt.split('- ESCOLHA O ESTILO PELA PERGUNTA').length - 1).toBe(1);
  });
});

// O prompt ensinava cinco opções de bloco (order, orientation, reference, stack,
// table) que o REPORT_PLAN_SCHEMA, com additionalProperties: false, tornava
// impossíveis de emitir. O modelo lia "use reference: [...]" e o campo era
// recusado na saída estruturada — duas partes do mesmo prompt se contradizendo.
describe('o que o prompt ensina, o schema aceita', () => {
  const props = REPORT_PLAN_SCHEMA.properties.pages.items.properties.blocks.items;

  it('toda BLOCK_OPTIONS tem campo correspondente no schema do bloco', () => {
    const ausentes = BLOCK_OPTIONS.map((o) => String(o.chave).split(':')[0].trim()).filter((k) => !props.properties[k]);
    expect(ausentes, `ensinadas no prompt e proibidas no schema: ${ausentes.join(', ')}`).toEqual([]);
  });

  it('o bloco continua fechado — campo novo entra de propósito, não por acaso', () => {
    expect(props.additionalProperties).toBe(false);
  });
});

describe('o fallback também serve ao erro de compilação', () => {
  it('recusar o contrato diz para onde ir', () => {
    const vb = { v: 1, id: 'x', queries: [{ name: 'x' }], dims: [], metrics: [], params: [], style: 'graph.bar', children: [] };
    expect(() => compileViewblock(vb, { vb, source: { name: 'f', columns: [] }, baseSql: 'select 1' })).toThrow(
      /use "tabular"/
    );
  });
});
