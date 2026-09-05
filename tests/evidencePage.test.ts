import { describe, it, expect } from 'vitest';
import { buildModel } from '../web/src/builder/infer';
import { buildEvidenceMd, defaultPageName } from '../web/src/builder/evidencePage';
import { EMPTY_SEL } from '../web/src/builder/types';
import type { Selections, SourceInfo } from '../web/src/builder/types';

const SOURCES: SourceInfo[] = [
  {
    name: 'vendas',
    columns: [
      { name: 'valor', type: 'DOUBLE' },
      { name: 'regiao', type: 'VARCHAR' },
    ],
  },
];
const model = buildModel(SOURCES, 'vendas')!;

describe('página Evidence gerada pelo builder', () => {
  const sel: Selections = {
    ...EMPTY_SEL,
    groupBy: [{ table: 'vendas', column: 'regiao' }],
    measures: [{ column: 'valor', agg: 'sum' }],
  };

  it('nome default é um slug fato_por_dimensão', () => {
    expect(defaultPageName(model, sel)).toBe('vendas_por_regiao');
    expect(defaultPageName(model, EMPTY_SEL)).toBe('vendas');
  });

  it('com seleção válida emite um VIEW BLOCK (marcador + sql + tag)', () => {
    const md = buildEvidenceMd('select 1', sel, model);
    expect(md).toMatch(/<!-- viewblock v1 \{.*"style":"graph\.bar".*\} -->/);
    expect(md).toMatch(/```sql vb_[0-9a-f]{6}/);
    expect(md).toMatch(/<BarChart data=\{vb_[0-9a-f]{6}\} x=regiao y=sum_valor\/>/);
    expect(md).toContain('<!-- /viewblock -->');
  });

  it('id do bloco é determinístico para o mesmo SQL+seleção', () => {
    expect(buildEvidenceMd('select 1', sel, model)).toBe(buildEvidenceMd('select 1', sel, model));
  });

  it('sem seleção estruturada cai no md simples (sem View Block)', () => {
    const md = buildEvidenceMd('select 1', EMPTY_SEL, model);
    expect(md).toContain('```sql consulta');
    expect(md).toContain('<DataTable data={consulta}/>');
    expect(md).not.toContain('viewblock');
  });
});
