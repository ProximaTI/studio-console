// Camada de VISUALIZAÇÃO dos View Blocks no notebook: mapeia células ↔ regiões
// delimitadas pelos marcadores. NÃO altera parse/serialize (cells.ts intocado);
// os marcadores vivem dentro de células text e round-tripam byte a byte.
import { parseVbMeta, isVbClose } from '../../../shared/viewblock.js';
import { Cell } from './cells';

export type VbInfo = {
  id: string;
  meta: any;
  start: number; // índice da 1ª célula do bloco (contém o marcador de abertura)
  end: number; // índice da última célula (contém o fechamento)
};

export type VbCellState = {
  vb: VbInfo | null; // bloco de topo a que a célula pertence
  isFirst: boolean; // 1ª célula do bloco (recebe a moldura/cabeçalho)
};

/**
 * Varre as células na ordem e resolve as regiões de View Block (célula que
 * contém a abertura até a que contém o fechamento). Células sql nunca têm
 * marcadores (as cercas ficam fora do fonte da célula), então basta olhar
 * text/raw. Blocos aninhados (F3) ficam DENTRO da moldura do bloco de topo;
 * blocos sem fechamento são ignorados (sem meia-trava).
 */
export function computeVbRanges(cells: Cell[]): { ranges: VbInfo[]; states: VbCellState[] } {
  const stack: { meta: any; start: number }[] = [];
  const ranges: VbInfo[] = [];

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.type === 'sql') continue;
    for (const line of String(c.source || '').split('\n')) {
      const meta = parseVbMeta(line);
      if (meta) {
        stack.push({ meta, start: i });
        continue;
      }
      if (isVbClose(line) && stack.length) {
        const open = stack.pop()!;
        if (stack.length === 0) {
          ranges.push({ id: String(open.meta.id || 'vb_' + open.start), meta: open.meta, start: open.start, end: i });
        }
      }
    }
  }

  const states: VbCellState[] = cells.map((_, i) => {
    const vb = ranges.find((r) => i >= r.start && i <= r.end) || null;
    return { vb, isFirst: !!vb && i === vb.start };
  });
  return { ranges, states };
}

/** Célula cujo fonte é SÓ marcador(es) — não renderiza nada visível no bloco. */
export function isMarkerOnlyCell(c: Cell): boolean {
  if (c.type === 'sql') return false;
  const lines = String(c.source || '').split('\n');
  let hasMarker = false;
  for (const l of lines) {
    if (!l.trim()) continue;
    if (parseVbMeta(l) || isVbClose(l)) {
      hasMarker = true;
      continue;
    }
    return false;
  }
  return hasMarker;
}
