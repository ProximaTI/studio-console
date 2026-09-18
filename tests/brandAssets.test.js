import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineBrandAssets } from '../server/publish/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'web', 'public', 'brand');
// Os logotipos são MARCA e não versionam (ver scripts/fetch_brand_assets.mjs):
// onde eles não existem, o teste do caminho feliz é pulado em vez de falhar.
const sample = fs.existsSync(BRAND) ? fs.readdirSync(BRAND).find((f) => f.endsWith('.svg')) : null;

describe('inlineBrandAssets — imagem local vira data URI no publish', () => {
  it.skipIf(!sample)('troca /brand/<arquivo> pelo conteúdo embutido', () => {
    const out = inlineBrandAssets(`![CAPES](/brand/${sample})`);
    expect(out).toMatch(/^!\[CAPES\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)$/);
    // o base64 é MESMO o arquivo do disco, não um placeholder
    const b64 = out.slice(out.indexOf('base64,') + 7, -1);
    expect(Buffer.from(b64, 'base64').equals(fs.readFileSync(path.join(BRAND, sample)))).toBe(true);
  });

  it('arquivo ausente não quebra o publish: mantém o caminho e avisa', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const md = '![x](/brand/inexistente-9x9.svg)';
    expect(inlineBrandAssets(md)).toBe(md);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fetch_brand_assets'));
    warn.mockRestore();
  });

  it.skipIf(!sample)('também resolve o src de <img>, que é a forma com tamanho', () => {
    const out = inlineBrandAssets(`<img src="/brand/${sample}" alt="CAPES" width=190/>`);
    expect(out).toContain('data:image/svg+xml;base64,');
    expect(out).toContain('width=190'); // os demais atributos ficam intactos
    expect(out).not.toContain('/brand/');
  });

  it('não toca em links normais nem em imagens de fora de /brand', () => {
    const md = '[doc](/brand-guide/x.pdf) ![remota](https://ex.com/a.svg) ![mapa](/maps/brazil.geo.json)';
    expect(inlineBrandAssets(md)).toBe(md);
  });

  it('extensão não suportada é deixada como está (sem mime inventado)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const md = '![x](/brand/logo.tiff)';
    expect(inlineBrandAssets(md)).toBe(md);
    warn.mockRestore();
  });
});
