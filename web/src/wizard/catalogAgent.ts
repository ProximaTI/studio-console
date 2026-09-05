// Grounding do agente no CATÁLOGO (F3 §2): a proposta do agente traz só NOMES;
// aqui ela é validada contra o catálogo — fora do catálogo = rejeitada e
// re-pedida. SQL jamais transita (invariante mantido: quem gera é o compilador).
import type { CatSel } from './vbState';

export function validateCatalogProposal(
  catalog: any,
  proposal: { metrics?: string[]; dimensions?: string[] }
): { ok: boolean; catSel: CatSel; rejected: string[] } {
  const rejected: string[] = [];
  const metrics = (proposal.metrics || []).filter((n) => {
    if (catalog?.metrics?.[n]) return true;
    rejected.push(n);
    return false;
  });
  const dims: CatSel['dims'] = [];
  for (const d of proposal.dimensions || []) {
    const [dim, level] = String(d).split('.');
    const def = catalog?.dimensions?.[dim];
    if (!def || (level && !(def.hierarchy || []).includes(level))) {
      rejected.push(d);
      continue;
    }
    dims.push({ dim, ...(level ? { level } : {}) });
  }
  return { ok: rejected.length === 0 && metrics.length + dims.length > 0, catSel: { metrics, dims }, rejected };
}
