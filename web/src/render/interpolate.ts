// Re-export do módulo compartilhado — a implementação única vive em shared/templating.js
// (usada também pelo servidor e pelos apps publicados via bundle StudioRuntime).
export {
  paramNameFromFile,
  escapeSqlValue,
  applyTemplates,
  renderInline,
  collectInputNames,
  collectParamRefs,
} from '../../../shared/templating.js';
