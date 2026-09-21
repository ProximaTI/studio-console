import { describe, it, expect } from 'vitest';
import { STYLES, styleById, compileViewblock, isTemporalDim } from '../shared/viewStyles.js';
import { findViewblocks } from '../shared/viewblock.js';
import { lintEvidenceCompat } from '../shared/evidenceLint.js';
import { parseCells, serializeCells } from '../web/src/notebook/cells';
import { buildSql } from '../web/src/builder/sqlgen';
import { buildModel } from '../web/src/builder/infer';
import { EMPTY_SEL } from '../web/src/builder/types';

const SOURCE = {
  name: 'comissoes',
  columns: [
    { name: 'unidade', type: 'VARCHAR' },
    { name: 'atendimento_id', type: 'VARCHAR' },
    { name: 'valor', type: 'DOUBLE' },
    { name: 'ano', type: 'BIGINT' },
    { name: 'uf', type: 'VARCHAR' },
  ],
};

function vbBase(over = {}) {
  return {
    v: 1,
    id: 'vb_test01',
    source: { kind: 'source', name: 'comissoes' },
    queries: [{ name: 'vb_test01', sql: null }],
    dims: [{ table: 'comissoes', column: 'unidade' }],
    metrics: [{ column: 'atendimento_id', agg: 'count_distinct', label: 'Atendimentos' }],
    params: [],
    style: 'graph.bar',
    children: [],
    ...over,
  };
}
const BASE_SQL = 'select unidade, count(distinct atendimento_id) as count_distinct_atendimento_id from comissoes group by 1 order by 2 desc';
const compile = (vb) => compileViewblock(vb, { vb, source: SOURCE, baseSql: BASE_SQL });

describe('registro de estilos', () => {
  it('todos os estilos registrados com contrato', () => {
    expect(STYLES.map((s) => s.id)).toEqual([
      'tabular', 'graph.bar', 'graph.line', 'graph.bubble', 'group', 'freeform',
      'connectionmap', 'collabgraph', 'areamap', 'graph.range', 'graph.bump', 'graph.histogram', 'nested', 'pivot',
    ]);
    for (const s of STYLES) {
      expect(typeof s.requires).toBe('function');
      expect(typeof s.compile).toBe('function');
      expect(s.queryCount).toBe(s.id === 'collabgraph' ? 2 : 1);
    }
  });

  it('requires nega contrato não atendido, com motivo', () => {
    const semDim = vbBase({ dims: [] });
    expect(styleById('graph.bar').requires(semDim, SOURCE).ok).toBe(false);
    expect(styleById('graph.bar').requires(semDim, SOURCE).reason).toMatch(/1 dimensão/);
    expect(styleById('tabular').requires(semDim, SOURCE).ok).toBe(false);
    expect(styleById('group').requires(vbBase(), SOURCE).ok).toBe(false); // só 1 dim
    expect(styleById('freeform').requires(semDim, SOURCE).ok).toBe(true); // métrica basta
  });

  it('graph.line exige dimensão temporal (nome ou tipo)', () => {
    expect(isTemporalDim({ table: 'comissoes', column: 'ano' }, SOURCE)).toBe(true);
    expect(isTemporalDim({ table: 'comissoes', column: 'unidade' }, SOURCE)).toBe(false);
    const anoVb = vbBase({ dims: [{ table: 'comissoes', column: 'ano' }] });
    expect(styleById('graph.line').requires(anoVb, SOURCE).ok).toBe(true);
    expect(styleById('graph.line').requires(vbBase(), SOURCE).ok).toBe(false);
  });

  it('cada estilo compila para a tag esperada', () => {
    expect(compile(vbBase({ style: 'tabular' }))).toContain('<DataTable data={vb_test01}>');
    expect(compile(vbBase({ style: 'graph.bar' }))).toContain('<BarChart data={vb_test01} x=unidade y=count_distinct_atendimento_id seriesLabels={["Atendimentos"]}/>');
    const line = vbBase({ style: 'graph.line', dims: [{ table: 'comissoes', column: 'ano' }] });
    expect(compile(line)).toContain('<LineChart data={vb_test01} x=ano y=count_distinct_atendimento_id seriesLabels={["Atendimentos"]}/>');
    // série temporal sai CRONOLÓGICA, não pela métrica desc do SQL da fonte
    expect(compile(line)).toContain('order by "ano"');
    // group no cruzamento simples (2 dims, 1 métrica) É a barra empilhada
    const grp = vbBase({ style: 'group', dims: [{ table: 'comissoes', column: 'uf' }, { table: 'comissoes', column: 'unidade' }] });
    expect(compile(grp)).toContain('<BarChart data={vb_test01} x=uf y=count_distinct_atendimento_id series=unidade type=stacked/>');
    const free = vbBase({ style: 'freeform', dims: [] });
    expect(compile(free)).toContain('<BigValue data={vb_test01} value=count_distinct_atendimento_id title="Atendimentos"/>');
  });

  it('multi-métrica em graph vira y={[...]}; labels viram <Column title>', () => {
    const multi = vbBase({
      metrics: [
        { column: 'atendimento_id', agg: 'count_distinct', label: 'Atendimentos' },
        { column: 'valor', agg: 'sum' },
      ],
    });
    expect(compile(multi)).toContain('y={["count_distinct_atendimento_id","sum_valor"]}');
    const tab = compile({ ...multi, style: 'tabular' });
    expect(tab).toContain('<Column id=count_distinct_atendimento_id title="Atendimentos"/>');
    expect(tab).toContain('<Column id=sum_valor/>');
  });

  it('graph propaga fmt (yFmt, se único) e labels (seriesLabels) das métricas', () => {
    const comFmt = vbBase({
      metrics: [
        { column: 'valor', agg: 'sum', label: 'Faturamento', fmt: 'brl' },
        { column: 'atendimento_id', agg: 'count_distinct', fmt: 'brl' },
      ],
    });
    const out = compile(comFmt);
    expect(out).toContain(' yFmt=brl');
    expect(out).toContain('seriesLabels={["Faturamento","count_distinct_atendimento_id"]}');
    const misto = vbBase({
      metrics: [
        { column: 'valor', agg: 'sum', fmt: 'brl' },
        { column: 'atendimento_id', agg: 'count_distinct', fmt: 'num0' },
      ],
    });
    const out2 = compile(misto);
    expect(out2).not.toContain('yFmt');
    expect(out2).not.toContain('seriesLabels');
  });

  it('reference vira refLine; a métrica lida por `from` não vira série', () => {
    const semRef = compile(vbBase({ style: 'graph.bar' }));
    expect(semRef).not.toContain('refLine');

    const comLiteral = compile(vbBase({ style: 'graph.bar', reference: [{ axis: 'y', value: 0, label: 'equilíbrio' }] }));
    expect(comLiteral).toContain('refLine={[{"axis":"y","value":0,"label":"equilíbrio"}]}');

    // `mediana` entra na query (para o valor existir) mas sai das séries
    const comFrom = compile(
      vbBase({
        style: 'graph.bar',
        metrics: [
          { column: 'atendimento_id', agg: 'count_distinct', label: 'Atendimentos' },
          { column: 'mediana', agg: 'max', alias: 'mediana' },
        ],
        reference: [{ axis: 'x', from: 'mediana' }],
      })
    );
    expect(comFrom).toContain('y=count_distinct_atendimento_id');
    expect(comFrom).not.toContain('y={[');
    expect(comFrom).toContain('refLine={[{"axis":"x","from":"mediana"}]}');
  });

  it('table: {search, rows} vira atributo da DataTable; sem a chave a saída não muda', () => {
    const semTable = compile(vbBase({ style: 'tabular' }));
    expect(semTable).toContain('<DataTable data={vb_test01}>');
    expect(semTable).not.toContain('search=');
    expect(semTable).not.toContain('rows=');

    const comBusca = compile(vbBase({ style: 'tabular', table: { search: true, rows: 25 } }));
    expect(comBusca).toContain('<DataTable data={vb_test01} search=true rows=25>');

    // vale nos dois estilos que desenham tabela — no group, fora do cruzamento
    // simples, que é onde ele volta a ser tabela (3 dimensões)
    const grupo = compile(
      vbBase({
        style: 'group',
        dims: [
          { table: 'comissoes', column: 'uf' },
          { table: 'comissoes', column: 'unidade' },
          { table: 'comissoes', column: 'ano' },
        ],
        table: { search: true },
      })
    );
    expect(grupo).toContain('<DataTable data={vb_test01} search=true>');

    // tabela sem rótulo nenhum continua self-closing, agora com os atributos
    const semRotulo = compile(
      vbBase({ style: 'tabular', metrics: [{ column: 'atendimento_id', agg: 'count_distinct' }], table: { rows: 10 } })
    );
    expect(semRotulo).toContain('<DataTable data={vb_test01} rows=10/>');
  });

  it('freeform propaga o fmt da métrica para o BigValue (paridade com <Column>)', () => {
    const comFmt = vbBase({
      style: 'freeform',
      dims: [],
      metrics: [
        { column: 'valor', agg: 'sum', alias: 'valor_total', label: 'Faturamento', fmt: 'brl' },
        { column: 'atendimento_id', agg: 'count_distinct', label: 'Atendimentos' }, // sem fmt: sai sem o atributo
      ],
    });
    const out = compile(comFmt);
    expect(out).toContain('<BigValue data={vb_test01} value=valor_total title="Faturamento" fmt=brl/>');
    expect(out).toContain('<BigValue data={vb_test01} value=count_distinct_atendimento_id title="Atendimentos"/>');
  });

  it('compilar com contrato violado lança erro claro', () => {
    expect(() => compile(vbBase({ style: 'group' }))).toThrow(/contrato/);
    expect(() => compile(vbBase({ style: 'inexistente' }))).toThrow(/desconhecido/);
  });
});

describe('argumentos enum (Passo 3)', () => {
  const comParam = vbBase({ params: [{ name: 'ano', type: 'enum', from: 'ano', default: '%', label: 'Ano' }] });

  it('gera query de opções + Dropdown com "Todos"', () => {
    const out = compile(comParam);
    expect(out).toContain('```sql vb_test01_ano_opts');
    expect(out).toContain('select distinct cast("ano" as varchar) as value');
    expect(out).toContain('<Dropdown name=ano data={vb_test01_ano_opts} value=value title="Ano">');
    expect(out).toContain('<DropdownOption value="%" valueLabel="Todos"/>');
  });

  it('tipo desconhecido é rejeitado com mensagem clara', () => {
    const badVb = vbBase({ params: [{ name: 'x', type: 'coisa', from: 'ano' }] });
    expect(() => compile(badVb)).toThrow(/desconhecido/);
  });

  it('sqlgen injeta o predicado LIKE canônico do param', () => {
    const model = buildModel([SOURCE], 'comissoes');
    const sql = buildSql(
      model,
      { ...EMPTY_SEL, groupBy: [{ table: 'comissoes', column: 'unidade' }], measures: [{ column: 'atendimento_id', agg: 'count_distinct' }] },
      [{ name: 'ano', type: 'enum', from: 'ano', default: '%' }]
    );
    expect(sql).toContain('count(distinct f."atendimento_id") as "count_distinct_atendimento_id"');
    expect(sql).toContain("cast(f.\"ano\" as varchar) like '${inputs.ano.value}'");
  });
});

describe('compileViewblock (montagem canônica)', () => {
  it('marcador + células separadas por linha em branco; queries[] reflete o emitido', () => {
    const out = compile(vbBase());
    const page = '# T\n\n' + out + '\n';
    const vbs = findViewblocks(page);
    expect(vbs).toHaveLength(1);
    expect(vbs[0].meta.queries).toEqual([{ name: 'vb_test01', sql: null }]);
    // round-trip byte a byte pelas células do notebook (forma canônica)
    expect(serializeCells(parseCells(page))).toBe(page);
  });

  it('saída passa o linter de compatibilidade Evidence sem erros/avisos', () => {
    const out = compile(vbBase({ params: [{ name: 'ano', type: 'enum', from: 'ano', default: '%', label: 'Ano' }] }));
    const findings = lintEvidenceCompat('# T\n\n' + out + '\n');
    expect(findings.filter((f) => f.level !== 'info')).toEqual([]);
  });
});

describe('graph.bubble (dispersão)', () => {
  const vbBubble = (over = {}) =>
    vbBase({
      style: 'graph.bubble',
      dims: [{ table: 'comissoes', column: 'unidade' }],
      metrics: [
        { column: 'ie', agg: 'max', alias: 'ie' },
        { column: 'pct', agg: 'max', alias: 'pct' },
      ],
      ...over,
    });

  it('exige ≥1 dimensão e ≥2 métricas', () => {
    expect(styleById('graph.bubble').requires(vbBubble(), SOURCE).ok).toBe(true);
    const umaMetrica = vbBubble({ metrics: [{ column: 'ie', agg: 'max', alias: 'ie' }] });
    expect(styleById('graph.bubble').requires(umaMetrica, SOURCE).ok).toBe(false);
    const semDim = vbBubble({ dims: [] });
    expect(styleById('graph.bubble').requires(semDim, SOURCE).ok).toBe(false);
  });

  it('métrica 1→x, 2→y, 3→tamanho; dim 1→rótulo, 2→série', () => {
    expect(compile(vbBubble())).toContain('<BubbleChart data={vb_test01} x=ie y=pct label=unidade/>');
    const completo = vbBubble({
      dims: [{ table: 'comissoes', column: 'unidade' }, { table: 'comissoes', column: 'uf' }],
      metrics: [
        { column: 'ie', agg: 'max', alias: 'ie' },
        { column: 'pct', agg: 'max', alias: 'pct' },
        { column: 'cresc', agg: 'max', alias: 'cresc' },
      ],
    });
    expect(compile(completo)).toContain('<BubbleChart data={vb_test01} x=ie y=pct size=cresc label=unidade series=uf/>');
  });
});

describe('rótulo da dimensão no cabeçalho da tabela', () => {
  it('dimensão com label vira <Column title>, como já acontecia com métrica', () => {
    const vb = vbBase({
      style: 'tabular',
      dims: [{ table: 'apc_base', column: 'country_name', alias: 'country_name', label: 'País' }],
    });
    expect(compile(vb)).toContain('<Column id=country_name title="País"/>');
  });

  it('dimensão sem label continua sem title (retrocompatível)', () => {
    const vb = vbBase({ style: 'tabular', dims: [{ table: 'apc_base', column: 'editor' }] });
    expect(compile(vb)).toContain('<Column id=editor/>');
  });

  it('só o label da dimensão já basta para a tabela sair com colunas', () => {
    const vb = vbBase({
      style: 'tabular',
      dims: [{ table: 'apc_base', column: 'uf', alias: 'uf', label: 'UF' }],
      metrics: [{ column: 'doi', agg: 'count_distinct' }],
    });
    expect(compile(vb)).toContain('<Column id=uf title="UF"/>');
  });
});

describe('graph.bubble: fmt e label das métricas chegam aos eixos e ao tamanho', () => {
  const vb = vbBase({
    style: 'graph.bubble',
    dims: [{ table: 'comissoes', column: 'unidade' }],
    metrics: [
      { column: 'intl', agg: 'max', alias: 'pct_intl', fmt: 'pct1', label: '% internacional' },
      { column: 'cit', agg: 'max', alias: 'cited_per_work', fmt: 'num1', label: 'Citações por work' },
      { column: 'sh', agg: 'sum', alias: 'share', fmt: 'num0', label: 'Share' },
    ],
  });
  it('x recebe xFmt/xAxisTitle, y recebe yFmt/yAxisTitle, tamanho recebe sizeFmt/sizeLabel', () => {
    const out = compile(vb);
    expect(out).toContain('x=pct_intl y=cited_per_work size=share label=unidade');
    expect(out).toContain('xFmt=pct1 yFmt=num1 xAxisTitle="% internacional" yAxisTitle="Citações por work" sizeFmt=num0 sizeLabel="Share"');
  });
  it('métrica sem fmt/label não emite o atributo (saída byte-idêntica à anterior)', () => {
    const cru = vbBase({
      style: 'graph.bubble',
      dims: [{ table: 'comissoes', column: 'unidade' }],
      metrics: [{ column: 'ie', agg: 'max', alias: 'ie' }, { column: 'pct', agg: 'max', alias: 'pct' }],
    });
    expect(compile(cru)).toContain('<BubbleChart data={vb_test01} x=ie y=pct label=unidade/>');
  });
});
