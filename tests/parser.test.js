import { describe, it, expect } from 'vitest';
import { parseAttrs, parseFrontmatter, parseBlocks, stripHtmlComments } from '../shared/parser.js';

describe('parseAttrs', () => {
  it('valores simples, com aspas e com chaves', () => {
    expect(parseAttrs('data={vendas} x=mes title="Total por mês"')).toEqual({
      data: 'vendas',
      x: 'mes',
      title: 'Total por mês',
    });
  });

  it('array JSON dentro de chaves permanece string (resolvido depois)', () => {
    expect(parseAttrs('y={["a", "b"]}').y).toBe('["a", "b"]');
  });

  it('url com chaves dentro de aspas não é cortada', () => {
    expect(parseAttrs('url="https://ror.org/{inst[0].ror_id}"').url).toBe('https://ror.org/{inst[0].ror_id}');
  });
});

describe('parseFrontmatter', () => {
  it('extrai title e lista de queries', () => {
    const src = '---\ntitle: Painel\nqueries:\n  - kpis: kpis.sql\n  - lista: lista_x.sql\n---\n# Corpo\n';
    const { meta, body } = parseFrontmatter(src);
    expect(meta.title).toBe('Painel');
    expect(meta.queries).toEqual([
      { name: 'kpis', file: 'kpis.sql' },
      { name: 'lista', file: 'lista_x.sql' },
    ]);
    expect(body).toBe('# Corpo\n');
  });

  it('sem frontmatter retorna meta null e body intacto', () => {
    const { meta, body } = parseFrontmatter('# Só corpo');
    expect(meta).toBeNull();
    expect(body).toBe('# Só corpo');
  });
});

describe('parseBlocks', () => {
  it('separa md, sql e componente self-closing', () => {
    const src = '# Título\n\n```sql total\nselect 1 as n\n```\n\n<BigValue data={total} value=n/>\n';
    const blocks = parseBlocks(src);
    expect(blocks.map((b) => b.type)).toEqual(['md', 'sql', 'component']);
    expect(blocks[1]).toMatchObject({ name: 'total', sql: 'select 1 as n' });
    expect(blocks[2]).toMatchObject({ name: 'BigValue', attrs: { data: 'total', value: 'n' } });
  });

  it('componente multi-linha self-closing', () => {
    const src = '<BarChart\n  data={q}\n  x=mes\n  y=total\n/>\n';
    const [b] = parseBlocks(src);
    expect(b).toMatchObject({ type: 'component', name: 'BarChart', attrs: { data: 'q', x: 'mes', y: 'total' } });
  });

  it('tag pareada com filhos (DataTable > Column)', () => {
    const src = '<DataTable data={q} rows=20>\n  <Column id=a title="A"/>\n  <Column id=b/>\n</DataTable>\n';
    const [b] = parseBlocks(src);
    expect(b.name).toBe('DataTable');
    const cols = b.children.filter((c) => c.type === 'component' && c.name === 'Column');
    expect(cols).toHaveLength(2);
    expect(cols[0].attrs).toEqual({ id: 'a', title: 'A' });
  });

  it('containers aninhados: Grid > div > markdown + componente', () => {
    const src = '<Grid cols=2>\n<div>\n### Esquerda\n<DataTable data={q}/>\n</div>\n<div>\n### Direita\n</div>\n</Grid>\n';
    const [grid] = parseBlocks(src);
    expect(grid.name).toBe('Grid');
    const divs = grid.children.filter((c) => c.name === 'div');
    expect(divs).toHaveLength(2);
    const esq = divs[0].children;
    expect(esq.some((c) => c.type === 'md' && c.text.includes('### Esquerda'))).toBe(true);
    expect(esq.some((c) => c.type === 'component' && c.name === 'DataTable')).toBe(true);
  });

  it('par aberto e fechado na MESMA linha (CardTitle)', () => {
    const src = '<Card>\n<CardTitle>Meu título</CardTitle>\n</Card>\n';
    const [card] = parseBlocks(src);
    const title = card.children.find((c) => c.name === 'CardTitle');
    expect(title.children[0]).toMatchObject({ type: 'md', text: 'Meu título' });
  });

  it('sql dentro de container fica nos children (não no topo)', () => {
    const src = '<Tab label="A">\n```sql interna\nselect 2\n```\n</Tab>\n';
    const [tab] = parseBlocks(src);
    expect(tab.children.some((c) => c.type === 'sql' && c.name === 'interna')).toBe(true);
  });

  it('frontmatter vira o primeiro bloco', () => {
    const blocks = parseBlocks('---\ntitle: X\n---\ncorpo');
    expect(blocks[0].type).toBe('frontmatter');
    expect(blocks[0].meta.title).toBe('X');
    expect(blocks[1]).toMatchObject({ type: 'md', text: 'corpo' });
  });

  it('raw preserva o texto original para round-trip do notebook', () => {
    const raw = '<DataTable data={q}>\n  <Column id=a/>\n</DataTable>';
    const [b] = parseBlocks(raw + '\n');
    expect(b.raw).toBe(raw);
  });

  it('tag não fechada vira texto md (não engole o resto do arquivo)', () => {
    const blocks = parseBlocks('<DataTable data={q}>\nsem fechamento\n\n# Título depois\n');
    expect(blocks.every((b) => b.type === 'md')).toBe(true);
    expect(blocks.map((b) => b.text).join('\n')).toContain('# Título depois');
  });
});

describe('stripHtmlComments', () => {
  it('remove comentários inclusive multi-linha', () => {
    expect(stripHtmlComments('a <!-- x\ny -->b')).toBe('a b');
  });
});
