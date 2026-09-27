// Dropdown múltiplo: o app ☁ iniciava com valor ESCALAR e o IN (${inputs.x})
// saía sem aspas — `in (I204983213)`, Binder Error no DuckDB-WASM
// (capes-rnp/comparativo). A regra de valor inicial agora é UMA só, no editor e
// no app publicado: shared/templating.js#initialDropdownValue.
import { describe, it, expect } from 'vitest';
import { applyTemplates, initialDropdownValue } from '../shared/templating.js';
import { parseBlocks } from '../shared/parser.js';
import { itemsFromBlocks } from '../server/publish/queries.js';

const opts = [
  { value: 'I1', label: 'USP' },
  { value: 'I2', label: 'UNICAMP' },
  { value: 'I3', label: 'UFRJ' },
];

describe('applyTemplates com dropdown múltiplo', () => {
  it('array vira lista quotada para IN (...)', () => {
    expect(applyTemplates('where id in (${inputs.ent})', { ent: { value: ['I1', 'I3'] } })).toBe("where id in ('I1','I3')");
    expect(applyTemplates('where id in (${inputs.ent.value})', { ent: ['I2'] })).toBe("where id in ('I2')");
  });

  it("aspas dentro do valor são escapadas", () => {
    expect(applyTemplates('in (${inputs.x})', { x: ["O'Neil"] })).toBe("in ('O''Neil')");
  });

  it('escalar NÃO é quotado — por isso o múltiplo precisa nascer array', () => {
    expect(applyTemplates('in (${inputs.x})', { x: 'I1' })).toBe('in (I1)');
  });
});

describe('initialDropdownValue', () => {
  it('multiple: defaultValue array, filtrado às opções existentes', () => {
    expect(initialDropdownValue({ multiple: true, defaultValue: ['I3', 'I9', 'I1'] }, opts)).toEqual(['I3', 'I1']);
  });

  it('multiple: default escalar vira [dv]; sem default, [1ª opção]; sem opções, []', () => {
    expect(initialDropdownValue({ multiple: 'true', defaultValue: 'I2' }, opts)).toEqual(['I2']);
    expect(initialDropdownValue({ multiple: true }, opts)).toEqual(['I1']);
    expect(initialDropdownValue({ multiple: true, defaultValue: '' }, opts)).toEqual(['I1']);
    expect(initialDropdownValue({ multiple: true }, [])).toEqual([]);
  });

  it('simples: defaultValue se for opção, senão a 1ª; sem opções, undefined', () => {
    expect(initialDropdownValue({ defaultValue: 'I2' }, opts)).toBe('I2');
    expect(initialDropdownValue({ defaultValue: 'I9' }, opts)).toBe('I1');
    expect(initialDropdownValue({}, opts)).toBe('I1');
    expect(initialDropdownValue({}, [])).toBeUndefined();
  });

  it('compara como texto (número da query × texto do atributo)', () => {
    expect(initialDropdownValue({ defaultValue: '2024' }, [{ value: 2023 }, { value: 2024 }])).toBe('2024');
    expect(initialDropdownValue({ multiple: true, defaultValue: [2024] }, [{ value: '2024' }])).toEqual([2024]);
  });
});

describe('itemsFromBlocks leva multiple e defaultValue ao app publicado', () => {
  const md = `\`\`\`sql lista
select 'I1' as institution_id, 'USP' as institution_name
\`\`\`

<Dropdown
  data={lista}
  name=entidades
  value=institution_id
  label=institution_name
  multiple=true
  defaultValue={["I22995504", "I21229846"]}
/>

<Dropdown name=eixo_y defaultValue="share">
  <DropdownOption value="works_count" valueLabel="Scholarly Output" />
  <DropdownOption value="share" valueLabel="Share" />
</Dropdown>
`;
  const [multi, simples] = itemsFromBlocks(parseBlocks(md)).filter((i) => i.type === 'dropdown');

  it('múltiplo: multiple=true e defaultValue como ARRAY', () => {
    expect(multi.multiple).toBe(true);
    expect(multi.defaultValue).toEqual(['I22995504', 'I21229846']);
  });

  it('simples: multiple=false e o default da página vence a 1ª opção', () => {
    expect(simples.multiple).toBe(false);
    expect(simples.defaultValue).toBe('share');
    expect(initialDropdownValue(simples, simples.staticOptions)).toBe('share');
  });
});
