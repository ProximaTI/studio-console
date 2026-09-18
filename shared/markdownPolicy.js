// Política de links do markdown-it — regra ÚNICA para os 3 ambientes (editor,
// 📦 snapshot, ☁ app), como os compiladores de SQL já são.
//
// O markdown-it aceita data URI de imagem para gif/png/jpeg/webp e RECUSA
// image/svg+xml: com `![logo](data:image/svg+xml;base64,…)` ele não gera <img>,
// imprime o texto cru da marcação. Foi exatamente o que aconteceu com os
// logotipos embutidos no publish.
//
// Por que liberar só este caso é seguro: o markdown-it monta um <img src=…>, e
// SVG carregado por <img> roda em modo seguro — script, <foreignObject> e
// carregamento externo não executam (é o mesmo motivo pelo qual um favicon SVG
// não é vetor de XSS). O risco que a regra do markdown-it evita é o SVG servido
// como DOCUMENTO (navegação direta, <object>, <embed>), que não é o que ocorre
// aqui. A liberação é restrita a data URI base64 declarando image/svg+xml:
// `data:` com qualquer outro conteúdo continua recusado pela regra original.

const INLINE_SVG = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]*$/;

/**
 * Estende o validateLink de uma instância markdown-it para aceitar também
 * imagem SVG embutida. Devolve a própria instância (encadeável).
 */
export function allowInlineSvg(md) {
  if (!md || typeof md.validateLink !== 'function') return md;
  const original = md.validateLink.bind(md);
  md.validateLink = (url) => INLINE_SVG.test(String(url).trim()) || original(url);
  return md;
}
