// Marcadores View Block (spec §4): metadado JSON de UMA linha em comentário HTML.
//
//   <!-- viewblock v1 {"id":"vb_ab12cd","style":"graph.bar",...} -->
//   ...células do bloco (```sql + tags + inputs)...
//   <!-- /viewblock -->
//
// Regras de robustez:
//  - O serializador escapa TODO '>' do JSON como > — assim nenhum '>'
//    aparece antes do terminador '-->' e o regex non-greedy do
//    stripHtmlComments nunca corta o comentário no meio de uma string.
//  - Marcadores dentro de cercas ``` são IGNORADOS (código, não estrutura).
//  - Nesting é nativo (contador de profundidade) — a F3 usa `children[]`;
//    chaves desconhecidas no JSON são preservadas (forward-compat).
//  - Bloco sem fechamento não vira viewblock (texto comum; sem meia-trava).

const OPEN_RE = /^\s*<!--\s*viewblock\s+v(\d+)\s+(\{.*\})\s*-->\s*$/;
const CLOSE_RE = /^\s*<!--\s*\/viewblock\s*-->\s*$/;
const FENCE_RE = /^\s*```/;

/** Linha de abertura de marcador (fora de cerca)? Retorna o meta ou null. */
export function parseVbMeta(line) {
  const m = OPEN_RE.exec(String(line || ''));
  if (!m) return null;
  try {
    const meta = JSON.parse(m[2]);
    if (meta && typeof meta === 'object') {
      if (meta.v == null) meta.v = Number(m[1]);
      return meta;
    }
    return null;
  } catch {
    return null; // JSON inválido = não é um marcador nosso
  }
}

/** Linha de fechamento de marcador? */
export function isVbClose(line) {
  return CLOSE_RE.test(String(line || ''));
}

/** Serializa o meta como linha de marcador (JSON 1 linha, '>' escapado). */
export function serializeVbMeta(vb) {
  const v = vb && vb.v != null ? vb.v : 1;
  const json = JSON.stringify(vb).replace(/>/g, '\\u003e');
  return `<!-- viewblock v${v} ${json} -->`;
}

/**
 * Encontra os View Blocks do fonte (linhas 0-based, marcadores inclusos).
 * Retorna raízes [{ meta, openLine, closeLine, children: [...] }]; blocos
 * aninhados ficam em children. Ignora marcadores dentro de cercas ``` e
 * descarta blocos sem fechamento.
 */
export function findViewblocks(md) {
  const lines = String(md || '').split('\n');
  const roots = [];
  const stack = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const meta = parseVbMeta(lines[i]);
    if (meta) {
      const node = { meta, openLine: i, closeLine: -1, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else roots.push(node);
      stack.push(node);
      continue;
    }
    if (isVbClose(lines[i]) && stack.length) {
      stack.pop().closeLine = i;
    }
  }
  const closed = (list) =>
    list
      .filter((n) => n.closeLine >= 0)
      .map((n) => ({ ...n, children: closed(n.children) }));
  return closed(roots);
}

function findById(list, id) {
  for (const n of list) {
    if (n.meta && n.meta.id === id) return n;
    const c = findById(n.children, id);
    if (c) return c;
  }
  return null;
}

/**
 * "Desacoplar": remove APENAS as duas linhas de marcador do bloco `id`
 * (o conteúdo vira texto livre; filhos aninhados mantêm os próprios marcadores).
 */
export function stripViewblockMarkers(md, id) {
  const node = findById(findViewblocks(md), id);
  if (!node) return md;
  const lines = String(md).split('\n');
  const out = lines.filter((_, i) => i !== node.openLine && i !== node.closeLine);
  return out.join('\n');
}

/**
 * Substitui o bloco `id` inteiro (marcadores + conteúdo) por `novoBloco`
 * (string já com os próprios marcadores) — a recompilação do Passo 4.
 */
export function spliceViewblock(md, id, novoBloco) {
  const node = findById(findViewblocks(md), id);
  if (!node) return md;
  const lines = String(md).split('\n');
  const before = lines.slice(0, node.openLine);
  const after = lines.slice(node.closeLine + 1);
  return [...before, ...String(novoBloco).replace(/\n$/, '').split('\n'), ...after].join('\n');
}
