import { describe, it, expect } from 'vitest';
import {
  paramNameFromFile,
  escapeSqlValue,
  applyTemplates,
  renderInline,
  collectInputNames,
  collectParamRefs,
  resolveAttr,
  resolveAttrs,
} from '../shared/templating.js';

describe('applyTemplates (placeholders SQL)', () => {
  it('${params.x} — sintaxe Evidence canônica', () => {
    expect(applyTemplates("where unidade = '${params.sigla}'", {}, { sigla: 'Batel' })).toBe("where unidade = 'Batel'");
  });

  it('${$page.params.x} — alias legado continua aceito', () => {
    expect(applyTemplates("where p = '${$page.params.prof}'", {}, { prof: 'Ana' })).toBe("where p = 'Ana'");
  });

  it('${inputs.x} e ${inputs.x.value} são equivalentes', () => {
    const inputs = { f: { value: 'Pix' } };
    expect(applyTemplates("a = '${inputs.f}'", inputs, {})).toBe("a = 'Pix'");
    expect(applyTemplates("a = '${inputs.f.value}'", inputs, {})).toBe("a = 'Pix'");
  });

  it('escapa aspas simples (injeção)', () => {
    expect(applyTemplates("x = '${params.n}'", {}, { n: "O'Brien" })).toBe("x = 'O''Brien'");
  });

  it('input array (Dropdown multiple) vira lista quotada para IN (...)', () => {
    const out = applyTemplates('id in (${inputs.ids})', { ids: { value: ['a', "b'c"] } }, {});
    expect(out).toBe("id in ('a','b''c')");
  });

  it('input ausente vira vazio', () => {
    expect(applyTemplates("x = '${inputs.nada}'", {}, {})).toBe("x = ''");
  });
});

describe('renderInline (interpolação {expr})', () => {
  const dataMap = { resumo: [{ total: 42, nome: 'Ana' }] };

  it('{query[0].col} e {query.length}', () => {
    expect(renderInline('Total {resumo[0].total} em {resumo.length} linha', dataMap, {})).toBe(
      'Total 42 em 1 linha'
    );
  });

  it('{params.x} e {inputs.x.value}', () => {
    expect(renderInline('{params.uf} / {inputs.f.value}', {}, { uf: 'SP' }, { f: { value: 'Pix' } })).toBe('SP / Pix');
  });

  it('expressão inválida vira ⟨?⟩ sem quebrar', () => {
    expect(renderInline('x {naoExiste[0].y} z', {}, {})).toBe('x ⟨?⟩ z');
  });

  it('\\{ escapado não interpola', () => {
    expect(renderInline('literal \\{assim}', dataMap, {})).toBe('literal {assim}');
  });
});

describe('coletores', () => {
  it('collectInputNames aceita com e sem .value', () => {
    expect(collectInputNames('a ${inputs.x} b ${inputs.y.value} ${inputs.x}')).toEqual(['x', 'y']);
  });

  it('collectParamRefs pega params.x e $page.params.x', () => {
    expect(collectParamRefs('${params.a} {params.b} $page.params.c')).toEqual(
      expect.arrayContaining(['a', 'b', 'c'])
    );
  });
});

describe('resolveAttr (atributos dinâmicos de componente)', () => {
  const ctx = { dataMap: { q: [{ n: 7 }] }, params: { uf: 'SP' }, inputs: { eixo: { value: 'share' } } };

  it('inputs.x.value → valor atual', () => {
    expect(resolveAttr('inputs.eixo.value', ctx)).toBe('share');
  });

  it('params.x → valor do parâmetro', () => {
    expect(resolveAttr('params.uf', ctx)).toBe('SP');
  });

  it('array JSON (aspas simples aceitas)', () => {
    expect(resolveAttr("['a', 'b']", ctx)).toEqual(['a', 'b']);
    expect(resolveAttr('["x"]', ctx)).toEqual(['x']);
  });

  it('string com {expr} interpola; string simples fica intacta', () => {
    expect(resolveAttr('https://x/{q[0].n}', ctx)).toBe('https://x/7');
    expect(resolveAttr('coluna_simples', ctx)).toBe('coluna_simples');
  });

  it('resolveAttrs aplica em todos e não toca no data=', () => {
    const out = resolveAttrs({ data: 'q', x: 'inputs.eixo.value' }, ctx);
    expect(out).toEqual({ data: 'q', x: 'share' });
  });
});

describe('utilitários', () => {
  it('paramNameFromFile', () => {
    expect(paramNameFromFile('unidade/[unidade].md')).toBe('unidade');
    expect(paramNameFromFile('index.md')).toBeNull();
  });

  it('escapeSqlValue', () => {
    expect(escapeSqlValue("a'b")).toBe("a''b");
    expect(escapeSqlValue(null)).toBe('');
  });
});
