// Pequenos múltiplos: partição dos grupos + ESCALA COMPARTILHADA.
//
// O estilo `nested` já entregava a metade difícil — UMA query particionada por
// row_number(), sem N+1. Faltava a metade que define a forma: painéis que se
// comparam. Sem domínio comum, cada painel calcula o próprio eixo e uma barra de
// 100 fica do mesmo tamanho de uma de 10 no painel ao lado — a leitura mente.
//
// Vive em shared/ porque o Repeat existe DUAS vezes (React no editor,
// runtime nos publicados). Antes deste módulo a partição estava copiada nos dois
// e a falha de escala também. Uma fonte, dois consumidores.

/**
 * Agrupa as linhas pelas colunas `by`, PRESERVANDO a ordem que veio do SQL
 * (o compilador já emite `order by <pais>, _rn`).
 * @returns {{groups: {key: string, rows: object[]}[], total: number}}
 *          `groups` já cortado em maxGroups; `total` é a contagem antes do corte.
 */
export function partitionBy(rows, by, maxGroups) {
  const cols = (Array.isArray(by) ? by : String(by || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
  const groups = [];
  const idx = new Map();
  for (const r of rows || []) {
    const key = cols.map((c) => String(r[c])).join(' · ');
    if (!idx.has(key)) {
      idx.set(key, groups.length);
      groups.push({ key, rows: [] });
    }
    groups[idx.get(key)].rows.push(r);
  }
  const lim = Math.max(1, Number(maxGroups) || 50);
  return { groups: groups.slice(0, lim), total: groups.length };
}

/**
 * Domínio Y comum a TODOS os painéis — o que transforma gráficos repetidos em
 * pequenos múltiplos.
 *
 * Barras ancoram no zero (altura é proporção: sem o zero a comparação de
 * tamanhos é falsa). Linhas usam o intervalo dos dados com folga de 5%, porque
 * ali o que se compara é a FORMA da série, e ancorar no zero achataria todas.
 *
 * @returns {{min: number, max: number}|null} null quando não há número algum.
 */
export function sharedDomain(groups, yCols, kind) {
  const cols = (Array.isArray(yCols) ? yCols : [yCols]).filter(Boolean);
  let min = Infinity;
  let max = -Infinity;
  for (const g of groups || []) {
    for (const r of g.rows || []) {
      for (const c of cols) {
        const v = Number(r[c]);
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (kind === 'line') {
    const pad = (max - min) * 0.05 || Math.abs(max) * 0.05 || 1;
    return { min: min - pad, max: max + pad };
  }
  return { min: Math.min(0, min), max: max === 0 ? 1 : max };
}

/** Painéis de gráfico vão em GRADE (varre-se de uma vez); tabela segue empilhada. */
export function isPanelChart(childStyle) {
  return childStyle === 'graph.bar' || childStyle === 'graph.line';
}

/** Altura do painel: menor que um gráfico solto — o ponto é ver muitos juntos. */
export const PANEL_HEIGHT = 156;
