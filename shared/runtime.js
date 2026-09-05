// Entry do bundle "StudioRuntime": o esbuild empacota isto como IIFE
// (globalName: StudioRuntime) e o publish injeta nos apps publicados.
// Assim, os apps usam EXATAMENTE o mesmo código do editor.
export { renderInline, applyTemplates, resolveAttr, resolveAttrs } from './templating.js';
export { buildMapOption, buildAreaMapOption, parseColorList } from './mapOption.js';
export { buildChartOption } from './chartOption.js';
export { formatNumber } from './format.js';
export { parseBlocks, parseAttrs, parseFrontmatter, stripHtmlComments } from './parser.js';
export { createPublishRenderer } from './publishRender.js';
export { parseVbMeta, isVbClose, serializeVbMeta, findViewblocks, stripViewblockMarkers, spliceViewblock } from './viewblock.js';
export { STYLES, styleById, compileViewblock, compileParamInputs, paramPredicate, isTemporalDim, metricAlias, dimAlias } from './viewStyles.js';
export { validateCatalog, parseDerived, internalDims, hierarchyOf, nearestColumn } from './semanticCatalog.js';
export { compileCatalogSql, dimAliasOf, dimExprOf, metricInfo } from './semanticCompile.js';
export { drillInfo, applyDrillDown, applyDrillUp, drillOptionsSql } from './drill.js';
export { validateReportPlan, REPORT_LIMITS } from './reportPlan.js';
export { compileSemanticBlock, compileReport } from './reportCompiler.js';
