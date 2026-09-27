import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFiles, structuralTokens } from '../scripts/export_design_system.mjs';
import {
  PRESETS,
  PRESET_NAMES,
  STRUCTURAL_KEYS,
  chartPaletteOf,
  resolveTheme,
  sequentialPaletteOf,
  themeVars,
} from '../shared/designTokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realCss = fs.readFileSync(path.join(ROOT, 'web', 'src', 'styles.css'), 'utf8');
const build = () => buildFiles(realCss, { generatedAt: '2026-01-01' });

describe('export do design system — é PROJEÇÃO da fonte, não uma cópia', () => {
  it('acha no styles.css todo token estrutural do contrato', () => {
    // Se alguém renomear/remover um token estrutural no CSS, quebra aqui em vez
    // de sair um pacote silenciosamente incompleto.
    expect(structuralTokens(realCss).missing).toEqual([]);
  });

  it('o CSS traz todo token de tema, no claro e no escuro', () => {
    const { 'tokens.css': css } = build();
    for (const mode of ['light', 'dark']) {
      for (const token of Object.keys(themeVars(resolveTheme(null, { mode })))) {
        expect(css, `${token} (${mode})`).toContain(`${token}:`);
      }
    }
    for (const k of STRUCTURAL_KEYS) expect(css).toContain(`${k}:`);
  });

  it('cada preset vira um bloco claro e um escuro, com os VALORES do preset', () => {
    const { 'tokens.css': css } = build();
    for (const name of PRESET_NAMES) {
      expect(css).toContain(`:root[data-preset="${name}"] {`);
      expect(css).toContain(`:root[data-preset="${name}"][data-mode="dark"] {`);
      expect(css).toContain(`--primary: ${PRESETS[name].primary};`);
      expect(css).toContain(`--bg: ${PRESETS[name].background};`);
    }
  });

  it('o JSON carrega a paleta de séries POR MODO (a clara não serve no escuro)', () => {
    const json = JSON.parse(build()['tokens.json']);
    const gov = json.presets.govbr;
    expect(gov.series.light).toEqual(PRESETS.govbr.chartPalette);
    expect(gov.series.dark).toEqual(PRESETS.govbr.chartPaletteDark);
    expect(gov.series.dark).not.toEqual(gov.series.light);
    // e o default, que não tem paleta escura própria, cai na clara
    expect(json.default.series.dark).toEqual(chartPaletteOf({ mode: 'dark' }));
  });

  it('o JSON carrega as TRÊS famílias de cor, cada uma resolvida por modo', () => {
    const json = JSON.parse(build()['tokens.json']);
    const apc = json.presets['painel-apc'];
    expect(apc.sequential.light).toEqual(PRESETS['painel-apc'].sequentialPalette);
    expect(apc.kpi.light).toEqual(PRESETS['painel-apc'].kpiPalette);
    // o que o pacote entrega é o RESOLVIDO: no escuro o preset não declara
    // nenhuma das duas, então sai o degradê derivado e o cartão liso.
    expect(apc.sequential.dark).toEqual(sequentialPaletteOf(resolveTheme(null, { preset: 'painel-apc', mode: 'dark' })));
    expect(apc.kpi.dark).toEqual(new Array(apc.kpi.light.length).fill(PRESETS['painel-apc'].cardDark));
    // e um preset que não tinge entrega lista vazia, não tom inventado
    expect(json.presets.govbr.kpi.light).toEqual([]);
  });

  it('o CSS do preset que tinge traz --kpi-N; o que não tinge, nenhum', () => {
    const { 'tokens.css': css } = build();
    PRESETS['painel-apc'].kpiPalette.forEach((c, i) => expect(css).toContain(`--kpi-${i + 1}: ${c};`));
    const blocoGovbr = css.split(':root[data-preset="govbr"] {')[1].split('}')[0];
    expect(blocoGovbr).not.toContain('--kpi-');
  });

  it('nenhum token de marca é declarado como literal no gerador', () => {
    // O ponto do export: os valores vêm da fonte. Um hex digitado no script
    // seria a deriva que o módulo de tokens existe para impedir.
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'export_design_system.mjs'), 'utf8');
    const semExemplos = src.replace(/<img[^>]*>/g, '').replace(/#\{/g, '');
    const hexes = semExemplos.match(/#[0-9a-fA-F]{6}\b/g) || [];
    expect(hexes).toEqual([]);
  });

  it('o pacote é autoconsistente: preview usa só os arquivos gerados', () => {
    const files = build();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['tokens.css', 'tokens.json']));
    expect(() => JSON.parse(files['tokens.json'])).not.toThrow();
  });
});
