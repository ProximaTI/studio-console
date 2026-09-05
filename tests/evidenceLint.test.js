import { describe, it, expect } from 'vitest';
import { lintEvidenceCompat, frontmatterQueries } from '../shared/evidenceLint.js';

const codes = (f) => f.map((x) => x.code);

describe('lintEvidenceCompat', () => {
  it('página canônica Evidence não gera achados', () => {
    const md = `# Título

\`\`\`sql vendas
select regiao, sum(valor) as total from vendas where regiao = '\${inputs.regiao.value}' group by 1
\`\`\`

<Dropdown name=regiao data={vendas} value=regiao/>
<BigValue data={vendas} value=total/>
<DataTable data={vendas}><Column id=regiao/></DataTable>
`;
    expect(lintEvidenceCompat(md)).toEqual([]);
  });

  it('componente desconhecido é error', () => {
    const f = lintEvidenceCompat('<FooBar data={x}/>');
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe('error');
    expect(f[0].code).toBe('unknown-component');
    expect(f[0].context).toBe('<FooBar>');
  });

  it('componentes custom da console pedem port Svelte (warn)', () => {
    const f = lintEvidenceCompat('<ConnectionMap data={x}/>\n\n<CollaborationGraph data={y}/>');
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.level === 'warn' && x.code === 'custom-component')).toBe(true);
  });

  it('Card não existe no Evidence core (warn), Tabs renderiza diferente (info)', () => {
    const md = '<Grid cols=2><Card><CardTitle>T</CardTitle></Card></Grid>\n\n<Tabs><Tab label=A>x</Tab></Tabs>';
    const f = lintEvidenceCompat(md);
    expect(codes(f)).toContain('console-only');
    expect(f.filter((x) => x.code === 'console-only').map((x) => x.context)).toEqual(
      expect.arrayContaining(['<Card>', '<CardTitle>'])
    );
    const tabs = f.find((x) => x.context === '<Tabs>');
    expect(tabs.level).toBe('info');
    expect(tabs.code).toBe('render-diff');
  });

  it('componente Evidence que a console não renderiza é info', () => {
    const f = lintEvidenceCompat('<Histogram data={x} x=col/>');
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe('info');
    expect(f[0].code).toBe('console-missing');
  });

  it('${inputs.x} sem .value é warn; com .value passa limpo', () => {
    const bad = lintEvidenceCompat('```sql q\nselect * from t where a = ${inputs.unidade}\n```');
    expect(codes(bad)).toEqual(['inputs-no-value']);
    expect(bad[0].message).toContain('inputs.unidade.value');
    const ok = lintEvidenceCompat('```sql q\nselect * from t where a = ${inputs.unidade.value}\n```');
    expect(ok).toEqual([]);
  });

  it('alias $page.params é warn no SQL e no markdown', () => {
    const md = '# {$page.params.unidade}\n\n```sql q\nselect * from t where s = ${$page.params.unidade}\n```';
    const f = lintEvidenceCompat(md);
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.code === 'page-params-alias' && x.level === 'warn')).toBe(true);
  });

  it('fonte schema.table vira info com instrução de source', () => {
    const f = lintEvidenceCompat('```sql q\nselect * from vendas.comissoes\n```');
    expect(f).toHaveLength(1);
    expect(f[0].code).toBe('schema-source');
    expect(f[0].message).toContain('"vendas"');
  });

  it('information_schema não conta como source', () => {
    expect(lintEvidenceCompat('```sql q\nselect * from information_schema.tables\n```')).toEqual([]);
  });

  it('linta queries externas do frontmatter via opts.queries', () => {
    const f = lintEvidenceCompat('# Página', {
      queries: [{ name: 'kpis.sql', sql: "select * from vendas.comissoes where e like '${inputs.unidade}'" }],
    });
    expect(codes(f).sort()).toEqual(['inputs-no-value', 'schema-source']);
    expect(f.every((x) => x.context === 'queries/kpis.sql')).toBe(true);
  });

  it('deduplica achados repetidos e ordena error > warn > info', () => {
    const md = '<FooBar/>\n\n<Tabs><Tab label=A>x</Tab></Tabs>\n\n```sql q\nselect ${inputs.a}, ${inputs.a} from t\n```';
    const f = lintEvidenceCompat(md);
    expect(codes(f)).toEqual(['unknown-component', 'inputs-no-value', 'render-diff']);
  });

  it('componentes dentro de containers são lintados (recursivo)', () => {
    const f = lintEvidenceCompat('<Grid cols=2><ConnectionMap data={x}/></Grid>');
    expect(codes(f)).toContain('custom-component');
  });
});

describe('frontmatterQueries', () => {
  it('extrai a lista name/file do frontmatter', () => {
    const md = '---\ntitle: X\nqueries:\n  - kpis: apc_kpis.sql\n  - anos: apc_anos.sql\n---\n# T';
    expect(frontmatterQueries(md)).toEqual([
      { name: 'kpis', file: 'apc_kpis.sql' },
      { name: 'anos', file: 'apc_anos.sql' },
    ]);
  });

  it('sem frontmatter retorna vazio', () => {
    expect(frontmatterQueries('# Só título')).toEqual([]);
  });
});
