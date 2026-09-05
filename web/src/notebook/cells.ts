// Conversão entre um arquivo .md e uma lista de "células" estilo Jupyter.
// O parsing da sintaxe é o módulo compartilhado (shared/parser.js) — este arquivo
// só adapta blocos -> células (com id) e faz o round-trip de serialização.
//
// Tipos de célula:
//   - 'text': prosa Markdown
//   - 'sql' : bloco ```sql nome ... ```
//   - 'raw' : conteúdo verbatim (tags de componente, inclusive multi-linha)

import { parseBlocks } from '../../../shared/parser.js';
import { collectInputNames } from '../../../shared/templating.js';
import { parseVbMeta, isVbClose } from '../../../shared/viewblock.js';

export type CellType = 'text' | 'sql' | 'raw';

export type Cell = {
  id: string;
  type: CellType;
  name?: string; // para células sql: nome da query
  source: string; // conteúdo (sem as cercas ```sql para células sql)
};

let counter = 0;
export function newId() {
  counter += 1;
  return 'c' + counter + '_' + (typeof performance !== 'undefined' ? Math.floor(performance.now()) : counter);
}

// Divide o texto de um bloco md em segmentos nas LINHAS DE MARCADOR viewblock:
// cada marcador vira célula própria (prosa vizinha fica em célula separada e
// portanto FORA da região read-only). Round-trip preservado: a serialização
// junta células com \n\n — o mesmo separador do formato canônico.
function splitAtVbMarkers(text: string): string[] {
  const lines = text.split('\n');
  if (!lines.some((l) => parseVbMeta(l) || isVbClose(l))) return [text];
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (t) out.push(t);
    buf = [];
  };
  for (const l of lines) {
    if (parseVbMeta(l) || isVbClose(l)) {
      flush();
      out.push(l.trim());
    } else {
      buf.push(l);
    }
  }
  flush();
  return out;
}

// Quebra o .md em células usando o parser compartilhado.
export function parseCells(src: string): Cell[] {
  const cells: Cell[] = parseBlocks(src).flatMap((b: any) => {
    if (b.type === 'sql') return [{ id: newId(), type: 'sql' as CellType, name: b.name, source: b.sql }];
    if (b.type === 'component') return [{ id: newId(), type: 'raw' as CellType, source: b.raw || '' }];
    // Frontmatter (Evidence) round-tripa como célula raw no topo.
    if (b.type === 'frontmatter') return [{ id: newId(), type: 'raw' as CellType, source: b.raw || '' }];
    const text = String(b.text || '').replace(/^\n+/, '').replace(/\n+$/, '');
    return splitAtVbMarkers(text).map((seg) => ({ id: newId(), type: 'text' as CellType, source: seg }));
  });
  if (cells.length === 0) cells.push({ id: newId(), type: 'text', source: '' });
  return cells;
}

// Reconstrói o .md a partir das células.
export function serializeCells(cells: Cell[]): string {
  const parts = cells.map((c) => {
    if (c.type === 'sql') return '```sql ' + (c.name || 'query') + '\n' + c.source.replace(/\s+$/, '') + '\n```';
    return c.source.replace(/\s+$/, '');
  });
  return parts.join('\n\n') + '\n';
}

// Extrai os nomes de inputs usados em ${inputs.X.value} em todas as células sql.
export function collectInputs(cells: Cell[]): string[] {
  const set = new Set<string>();
  for (const c of cells) {
    if (c.type !== 'sql') continue;
    for (const n of collectInputNames(c.source)) set.add(n);
  }
  return [...set];
}
