// Nome do pacote publicado pela ROTA da página (shared/pageRoutes.js). Antes era
// o basename: os cinco index.md em subpasta do capes-rnp publicavam todos em
// `index-app`, um sobrescrevendo o outro.
import { describe, it, expect } from 'vitest';
import { pageRoute, pagePackages, packageNameFor, isParamPage } from '../shared/pageRoutes.js';

// Páginas reais do capes-rnp (projeto externo) e do exemplo.
const CAPES_RNP = [
  'index.md',
  'area-capes/[capes_area_id].md',
  'comparativo/index.md',
  'instituicao/[institution_id].md',
  'metodologia/index.md',
  'pais/[country_code].md',
  'redes/index.md',
  'starter-analyses/crescimento-area-ies/index.md',
  'starter-analyses/index.md',
];
const EXEMPLO = ['index.md', 'comissoes.md', 'painel_rede.md', 'prof/index.md', 'prof/[prof].md', 'unidade/[unidade].md'];

describe('pageRoute', () => {
  it('index some da rota; subpasta entra', () => {
    expect(pageRoute('index.md')).toBe('');
    expect(pageRoute('faturamento.md')).toBe('faturamento');
    expect(pageRoute('comparativo/index.md')).toBe('comparativo');
    expect(pageRoute('a\\b\\index.md')).toBe('a/b');
    expect(pageRoute('/a/x.md')).toBe('a/x');
  });
});

describe('pagePackages', () => {
  it('capes-rnp: um pacote por index.md, nenhum repetido', () => {
    const t = pagePackages(CAPES_RNP);
    expect(t).toEqual({
      '': 'index',
      comparativo: 'comparativo',
      metodologia: 'metodologia',
      redes: 'redes',
      'starter-analyses': 'starter-analyses',
      'starter-analyses/crescimento-area-ies': 'starter-analyses-crescimento-area-ies',
    });
    const nomes = [...Object.values(t), ...CAPES_RNP.filter(isParamPage).map((p) => packageNameFor(p, CAPES_RNP))];
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('exemplo: prof/index.md não toma o pacote da parametrizada prof/[prof].md', () => {
    expect(packageNameFor('prof/[prof].md', EXEMPLO)).toBe('prof');
    expect(packageNameFor('prof/index.md', EXEMPLO)).toBe('prof-index');
    expect(pagePackages(EXEMPLO).prof).toBe('prof-index');
  });

  it('página comum em subpasta leva a pasta no nome; raiz fica como era', () => {
    expect(packageNameFor('evidence_pages_capes_bibliometria/README.md', [])).toBe('evidence_pages_capes_bibliometria-README');
    expect(packageNameFor('comissoes.md', EXEMPLO)).toBe('comissoes');
    expect(packageNameFor('index.md', EXEMPLO)).toBe('index');
  });

  it('parametrizada mantém a regra antiga (nome do diretório; na raiz, sem colchetes)', () => {
    expect(packageNameFor('unidade/[unidade].md', EXEMPLO)).toBe('unidade');
    expect(packageNameFor('[ies].md', [])).toBe('ies');
  });

  it('nome sempre casa com o formato aceito pela rota de prévia', () => {
    for (const p of [...CAPES_RNP, ...EXEMPLO, 'a b/ç.md']) expect(packageNameFor(p, CAPES_RNP)).toMatch(/^[\w\-[\]]+$/);
  });
});
