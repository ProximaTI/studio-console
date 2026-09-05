// Fachada do publish — a implementação vive em server/publish/:
//   queries.js   preparo (resolução de queries, fontes, itens, páginas [param])
//   assets.js    bundles (StudioRuntime, ECharts, DuckDB-WASM), GeoJSON, CSS
//   snapshot.js  Publish 📦 — HTML único offline com dados embutidos
//   app.js       Publish ☁ — Parquet + DuckDB-WASM (Universal SQL no cliente)
// O render dos componentes é ÚNICO para os dois modos: shared/publishRender.js,
// entregue às páginas via bundle StudioRuntime.
export { buildPublishedHtml } from './publish/snapshot.js';
export { buildPublishedApp } from './publish/app.js';
