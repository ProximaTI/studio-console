// Nome do PACOTE publicado de cada página, derivado da ROTA (layout Evidence):
//   index.md                  → rota ''            → index
//   faturamento.md            → 'faturamento'      → faturamento
//   comparativo/index.md      → 'comparativo'      → comparativo
//   a/b/index.md              → 'a/b'              → a-b
//   a/x.md                    → 'a/x'              → a-x
//   unidade/[unidade].md      → (parametrizada)    → unidade   (nome do diretório — regra antiga, mantida)
//
// Antes o nome era só o BASENAME: todo index.md em subpasta publicava em
// `index-app` e o último sobrescrevia os outros (capes-rnp tinha cinco). O
// runtime publicado resolve links pela MESMA tabela (pagePackages), então
// '/comparativo/' chega em '../comparativo-app/'.
//
// Pasta com índice E página parametrizada (prof/index.md + prof/[prof].md): o
// pacote `prof` é da parametrizada — os links '/prof/<valor>/' dependem disso —
// e o índice vira `prof-index`.

const norm = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
const safe = (s) => String(s).replace(/[^\w-]/g, '_');

export function isParamPage(rel) {
  return /^\[\w+\]\.md$/i.test(norm(rel).split('/').pop());
}

/** Pacote de página parametrizada: o nome do diretório (ou o do arquivo, na raiz). */
export function paramPackageName(rel) {
  const segs = norm(rel).split('/');
  const base = segs[segs.length - 1].replace(/\.md$/i, '');
  return safe(segs.length > 1 ? segs[segs.length - 2] : base.replace(/[[\]]/g, ''));
}

/** Rota Evidence de uma página não parametrizada, sem barras nas pontas. */
export function pageRoute(rel) {
  const segs = norm(rel).replace(/\.md$/i, '').split('/').filter(Boolean);
  if (segs[segs.length - 1] === 'index') segs.pop();
  return segs.join('/');
}

/**
 * Tabela rota → pacote de todas as páginas NÃO parametrizadas do projeto.
 * `relPaths`: caminhos relativos a pages/ (qualquer separador).
 */
export function pagePackages(relPaths) {
  const md = (relPaths || []).map(norm).filter((p) => /\.md$/i.test(p));
  const ocupados = new Set(md.filter(isParamPage).map(paramPackageName));
  const out = {};
  for (const rel of md.filter((p) => !isParamPage(p)).sort()) {
    const route = pageRoute(rel);
    let name = route ? route.split('/').map(safe).join('-') : 'index';
    if (ocupados.has(name)) name += /(^|\/)index\.md$/i.test(rel) ? '-index' : '-pagina';
    out[route] = name;
  }
  return out;
}

/** Nome do pacote de UMA página, no contexto das páginas do projeto. */
export function packageNameFor(rel, relPaths) {
  if (isParamPage(rel)) return paramPackageName(rel);
  const tabela = pagePackages([...(relPaths || []), rel]);
  return tabela[pageRoute(rel)];
}
