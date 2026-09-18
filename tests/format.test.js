import { describe, it, expect } from 'vitest';
import { formatNumber, cmpCell } from '../shared/format.js';

// Settings default: decimalSeparator ',' → locale pt-BR.
const PT = { organization: { decimalSeparator: ',' } };
const EN = { organization: { decimalSeparator: '.' } };

describe('formatNumber — códigos fmt do dialeto Evidence', () => {
  it('num0/num1/num2', () => {
    expect(formatNumber(1234.567, 'num0', PT)).toBe('1.235');
    expect(formatNumber(1234.5, 'num1', PT)).toBe('1.234,5');
    expect(formatNumber(1234, 'num2', PT)).toBe('1.234,00');
  });

  it('pct — fração 0..1 vira %', () => {
    expect(formatNumber(0.423, 'pct1', PT)).toBe('42,3%');
    expect(formatNumber(0.5, 'pct0', PT)).toBe('50%');
    expect(formatNumber(0.423, 'pct', PT)).toBe('42,3%'); // pct == pct1
  });

  it('estilo Excel: #,##0 e #,##0.00', () => {
    expect(formatNumber(11631, '#,##0', PT)).toBe('11.631');
    expect(formatNumber(1234.5, '#,##0.00', PT)).toBe('1.234,50');
  });

  it('moeda: brl e prefixo $ do Excel', () => {
    expect(formatNumber(10.5, 'brl', PT)).toContain('10,50');
    expect(formatNumber(10.5, '$#,##0.00', PT)).toBe('R$ 10,50');
  });

  it('datas: valor ISO passa direto cortado em 10 chars', () => {
    expect(formatNumber('2026-04-11T00:00:00', 'yyyy-mm-dd', PT)).toBe('2026-04-11');
  });

  it('default: até 2 casas, com locale', () => {
    expect(formatNumber(1234.567, undefined, PT)).toBe('1.234,57');
    expect(formatNumber(1234.5, undefined, EN)).toBe('1,234.5');
  });

  it('nulos e não-numéricos', () => {
    expect(formatNumber(null, 'num0', PT)).toBe('—');
    expect(formatNumber(undefined, 'num0', PT)).toBe('—');
    expect(formatNumber('', 'num0', PT)).toBe('—');
    expect(formatNumber('abc', 'num0', PT)).toBe('abc');
  });
});

describe('cmpCell — ordenação client-side da DataTable', () => {
  const ord = (arr, dir = 1) => arr.slice().sort((a, b) => cmpCell(a, b, dir));

  it('números comparam como números, não como texto', () => {
    expect(ord([100, 9, 1000])).toEqual([9, 100, 1000]);
    // o bug clássico: como texto, "1000" < "9"
    expect(ord(['100', '9', '1000'])).toEqual(['9', '100', '1000']);
  });

  it('nulo e vazio vão para o fim nas DUAS direções', () => {
    expect(ord([3, null, 1])).toEqual([1, 3, null]);
    expect(ord([3, null, 1], -1)).toEqual([3, 1, null]);
    expect(ord([3, '', 1], -1)).toEqual([3, 1, '']);
    expect(ord([3, undefined, 1])).toEqual([1, 3, undefined]);
  });

  it('texto compara com acento e caixa do jeito do leitor (pt-BR)', () => {
    expect(ord(['Óptica', 'Administração', 'zoologia'])).toEqual(['Administração', 'Óptica', 'zoologia']);
  });

  it('é estável para valores iguais', () => {
    expect(cmpCell(5, 5)).toBe(0);
    expect(cmpCell(null, undefined)).toBe(0);
  });
});
