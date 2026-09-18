import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { allowInlineSvg } from '../shared/markdownPolicy.js';

const plain = () => new MarkdownIt({ html: false, linkify: true });
const relaxed = () => allowInlineSvg(new MarkdownIt({ html: false, linkify: true }));
const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

describe('allowInlineSvg — libera SÓ imagem SVG embutida', () => {
  it('sem a política, o markdown-it imprime a marcação como texto', () => {
    // A regressão: o logotipo embutido no publish aparecia como "![CAPES](data:…".
    expect(plain().render(`![CAPES](${svg})`)).not.toContain('<img');
    expect(plain().validateLink(svg)).toBe(false);
  });

  it('com a política, vira <img> com o data URI intacto', () => {
    const out = relaxed().render(`![CAPES](${svg})`);
    expect(out).toContain('<img');
    expect(out).toContain(svg);
  });

  it('não afrouxa nada além disso', () => {
    const md = relaxed();
    for (const bad of [
      'javascript:alert(1)',
      'vbscript:x',
      'data:text/html;base64,AAAA',
      'data:image/svg+xml,<svg onload=alert(1)>', // sem base64: segue recusado
      'data:application/javascript;base64,AAAA',
    ]) {
      expect(md.validateLink(bad), bad).toBe(false);
    }
  });

  it('o que já passava continua passando', () => {
    const md = relaxed();
    for (const good of ['https://ex.com/a.png', '/maps/brazil.geo.json', 'data:image/png;base64,AAAA']) {
      expect(md.validateLink(good), good).toBe(true);
    }
  });

  it('é tolerante a instância inválida (não explode o render)', () => {
    expect(allowInlineSvg(null)).toBe(null);
    expect(allowInlineSvg({})).toEqual({});
  });
});
