// Formatação ÚNICA de números (códigos fmt= do dialeto Evidence).
// Consumido por: componentes React (web) e runtimes de publish via StudioRuntime.
//
// Códigos suportados: num0 num1 num2 (casas decimais), pct0 pct1 pct2
// (fração 0..1 -> %), brl (moeda), padrão = até 2 casas.

export function formatNumber(v, fmt, settings) {
  if (v === null || v === undefined || v === '') return '—';
  // Formatos de data do Evidence: o valor já vem como string ISO do DuckDB.
  if (/^y{2,4}[-/]?m{1,2}[-/]?d{1,2}/i.test(fmt || '')) return String(v).slice(0, 10);
  const sep = (settings && settings.organization && settings.organization.decimalSeparator) || ',';
  const locale = sep === ',' ? 'pt-BR' : 'en-US';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return String(v);
  if (fmt === 'brl') return n.toLocaleString(locale, { style: 'currency', currency: 'BRL' });
  // Códigos estilo Excel usados pelo Evidence: '#,##0', '#,##0.00', '$#,##0.00'…
  const xls = /^[$R$\s]*#,##0(?:\.(0+))?/.exec(fmt || '');
  if (xls) {
    const d = xls[1] ? xls[1].length : 0;
    const out = n.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
    return (fmt || '').trim().startsWith('$') || (fmt || '').includes('R$') ? 'R$ ' + out : out;
  }
  let m = /^pct(\d)?$/.exec(fmt || '');
  if (m) {
    const d = m[1] === undefined ? 1 : Number(m[1]);
    return (n * 100).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  }
  m = /^num(\d)$/.exec(fmt || '');
  if (m) {
    const d = Number(m[1]);
    return n.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  return n.toLocaleString(locale, { maximumFractionDigits: 2 });
}
