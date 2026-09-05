import { describe, it, expect } from 'vitest';
import { applyTemplates, collectInputNames } from '../shared/templating.js';
import { compileViewblock, paramPredicate } from '../shared/viewStyles.js';
import { lintEvidenceCompat } from '../shared/evidenceLint.js';
import { buildSql } from '../web/src/builder/sqlgen';
import { buildModel } from '../web/src/builder/infer';
import { EMPTY_SEL } from '../web/src/builder/types';

describe('templating — inputs livres (M9)', () => {
  it('${inputs.x.start}/${inputs.x.end} resolvem de {start, end}', () => {
    const sql = "select * from t where d between '${inputs.periodo.start}' and '${inputs.periodo.end}'";
    const out = applyTemplates(sql, { periodo: { start: '2024-01-01', end: '2025-12-31' } }, {});
    expect(out).toBe("select * from t where d between '2024-01-01' and '2025-12-31'");
  });

  it('DateRange indefinido vira vazio (não quebra o SQL)', () => {
    expect(applyTemplates("between '${inputs.p.start}' and '${inputs.p.end}'", {}, {})).toBe("between '' and ''");
  });

  it('${inputs.x} plano continua resolvendo escalar (TextInput/Slider)', () => {
    expect(applyTemplates("like '${inputs.busca}'", { busca: 'Ana%' }, {})).toBe("like 'Ana%'");
    expect(applyTemplates('>= ${inputs.minimo}', { minimo: 42 }, {})).toBe('>= 42');
  });

  it('collectInputNames pega .start/.end/.value/plano', () => {
    const sql = "${inputs.a} ${inputs.b.value} ${inputs.c.start} ${inputs.c.end}";
    expect(collectInputNames(sql).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('paramPredicate por tipo', () => {
  it('enum LIKE .value · text LIKE plano · number ≥ · date BETWEEN', () => {
    expect(paramPredicate({ name: 'e', type: 'enum' }, 'col')).toBe("cast(col as varchar) like '${inputs.e.value}'");
    expect(paramPredicate({ name: 't', type: 'text' }, 'col')).toBe("cast(col as varchar) like '${inputs.t}'");
    expect(paramPredicate({ name: 'n', type: 'number' }, 'col')).toBe('cast(col as double) >= ${inputs.n}');
    expect(paramPredicate({ name: 'd', type: 'date' }, 'col')).toBe(
      "cast(col as date) between '${inputs.d.start}' and '${inputs.d.end}'"
    );
  });
});

const SRC = {
  name: 'comissoes',
  columns: [
    { name: 'profissional', type: 'VARCHAR' },
    { name: 'valor', type: 'DOUBLE' },
    { name: 'data', type: 'DATE' },
  ],
};

describe('compilação dos inputs (M9)', () => {
  const vb = {
    v: 1,
    id: 'vb_in1',
    source: { kind: 'source', name: 'comissoes' },
    queries: [{ name: 'vb_in1', sql: null }],
    dims: [{ table: 'comissoes', column: 'profissional' }],
    metrics: [{ column: 'valor', agg: 'sum' }],
    params: [
      { name: 'busca', type: 'text', from: 'profissional', default: '%', label: 'Profissional' },
      { name: 'minimo', type: 'number', from: 'valor', min: 0, max: 500, step: 10, default: '0' },
      { name: 'periodo', type: 'date', from: 'data', label: 'Período' },
    ],
    style: 'tabular',
    children: [],
  };
  const model = buildModel([SRC], 'comissoes');
  const baseSql = buildSql(model, { ...EMPTY_SEL, groupBy: vb.dims, measures: vb.metrics }, vb.params);
  const block = compileViewblock(vb, { vb, source: SRC, baseSql });

  it('emite os três componentes com props', () => {
    expect(block).toContain('<TextInput name=busca title="Profissional" defaultValue="%"/>');
    expect(block).toContain('<Slider name=minimo title="minimo" min=0 max=500 step=10 defaultValue=0/>');
    expect(block).toContain('<DateRange name=periodo title="Período"/>');
  });

  it('sqlgen injeta os três predicados canônicos', () => {
    expect(baseSql).toContain("cast(f.\"profissional\" as varchar) like '${inputs.busca}'");
    expect(baseSql).toContain('cast(f."valor" as double) >= ${inputs.minimo}');
    expect(baseSql).toContain("cast(f.\"data\" as date) between '${inputs.periodo.start}' and '${inputs.periodo.end}'");
  });

  it('lint: página com os 3 inputs fica sem erros/avisos (plain refs canônicos)', () => {
    const findings = lintEvidenceCompat('# T\n\n' + block + '\n');
    expect(findings.filter((f) => f.level !== 'info')).toEqual([]);
  });

  it('lint: ${inputs.x} plano SEM componente TextInput/Slider ainda avisa', () => {
    const md = '```sql q\nselect * from t where a like \'${inputs.fantasma}\'\n```';
    const f = lintEvidenceCompat(md);
    expect(f.some((x) => x.code === 'inputs-no-value')).toBe(true);
  });
});
