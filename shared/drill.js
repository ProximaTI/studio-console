// Drill entre dimensões (F4 frente G): a semântica do gesto é MECÂNICA de
// reedição de View Block — descer = trocar a dim pelo nível mais fino da
// hierarquia + filtrar pelo valor clicado; subir = trocar pelo mais grosso e
// soltar o filtro. Transformações PURAS meta → meta; a recompilação fica com o
// compilador determinístico (compileCatalogSql) de sempre.
import { hierarchyOf } from './semanticCatalog.js';
import { dimAliasOf, dimExprOf } from './semanticCompile.js';

/**
 * Estado de drill de um bloco semântico: primeiro eixo do bloco que pertence a
 * uma hierarquia. Retorna null quando não há eixo "drillável".
 * { hierarchy, levels, dimIndex, current, down, up, crumbs: [{dim, value}] }
 */
export function drillInfo(catalog, meta) {
  const dims = meta?.dims || [];
  const filters = meta?.filters || [];
  for (const [i, d] of dims.entries()) {
    if (d.level) continue; // hierarquia interna (tempo) tem o próprio mecanismo
    const h = hierarchyOf(catalog, d.dim);
    if (!h) continue;
    const idx = h.levels.indexOf(d.dim);
    const crumbs = h.levels
      .slice(0, idx)
      .map((lvl) => {
        const f = filters.find((x) => x.dim === lvl && Array.isArray(x.values) && x.values.length);
        return f ? { dim: lvl, value: f.values[0] } : null;
      })
      .filter(Boolean);
    return {
      hierarchy: h.name,
      levels: h.levels,
      dimIndex: i,
      current: d.dim,
      down: idx < h.levels.length - 1 ? h.levels[idx + 1] : null,
      up: idx > 0 ? h.levels[idx - 1] : null,
      crumbs,
    };
  }
  return null;
}

function dimEntry(catalog, dimName) {
  const alias = dimAliasOf(catalog, { dim: dimName });
  return { dim: dimName, alias, column: alias, table: catalog.fact };
}

/** Desce um nível: dims[i] → nível mais fino; adiciona filtro do valor clicado. */
export function applyDrillDown(catalog, meta, value) {
  const info = drillInfo(catalog, meta);
  if (!info || !info.down) throw new Error('sem nível mais fino para descer nesta hierarquia');
  const dims = (meta.dims || []).map((d, i) => (i === info.dimIndex ? dimEntry(catalog, info.down) : d));
  const filters = [...(meta.filters || []).filter((f) => f.dim !== info.current), { dim: info.current, values: [value] }];
  return { ...meta, dims, filters };
}

/** Sobe um nível: dims[i] → nível mais grosso; solta o filtro que o prendia. */
export function applyDrillUp(catalog, meta) {
  const info = drillInfo(catalog, meta);
  if (!info || !info.up) throw new Error('já está no nível mais alto da hierarquia');
  const dims = (meta.dims || []).map((d, i) => (i === info.dimIndex ? dimEntry(catalog, info.up) : d));
  const filters = (meta.filters || []).filter((f) => f.dim !== info.up);
  return { ...meta, dims, filters };
}

/** SQL dos valores distintos do eixo atual (opções do gesto ⤵), respeitando os filtros ativos. */
export function drillOptionsSql(catalog, meta) {
  const info = drillInfo(catalog, meta);
  if (!info) return null;
  const expr = dimExprOf(catalog, { dim: info.current }, []);
  const fact = '"' + String(catalog.fact).replace(/"/g, '') + '"';
  const preds = (meta.filters || [])
    .filter((f) => Array.isArray(f.values) && f.values.length)
    .map((f) => {
      const e = dimExprOf(catalog, { dim: f.dim, level: f.level }, []);
      const vs = f.values.map((v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"));
      return vs.length === 1 ? `${e} = ${vs[0]}` : `${e} in (${vs.join(', ')})`;
    });
  const where = [`${expr} is not null`, ...preds].join('\n  and ');
  return `select distinct cast(${expr} as varchar) as value\nfrom ${fact}\nwhere ${where}\norder by 1\nlimit 200`;
}
