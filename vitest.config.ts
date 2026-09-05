import { defineConfig } from 'vitest/config';

// Testes dos módulos PUROS (sem DOM, sem servidor):
//   shared/  — parser, templating, format, chartOption (usados por editor, server e publish)
//   web/src/builder/ — infer, sqlgen, evidencePage (SQL Builder)
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'node',
  },
});
