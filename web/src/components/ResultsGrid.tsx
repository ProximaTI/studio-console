export default function ResultsGrid({
  columns,
  rows,
  error,
  measures,
}: {
  columns?: string[];
  rows?: any[];
  error?: string;
  measures?: boolean; // console: destaca colunas numéricas (--data) + tipo por coluna
}) {
  if (error) return <div className="error">{error}</div>;
  if (!columns || !rows) return <div className="muted">Rode uma query para ver resultados.</div>;
  if (rows.length === 0) return <div className="muted">Sem linhas.</div>;
  // Teto de exibição: resultados gigantes (select * sem limit) congelavam a UI.
  const MAX = 500;
  const shown = rows.length > MAX ? rows.slice(0, MAX) : rows;
  const numCols = new Set(columns.filter((c) => typeof shown[0]?.[c] === 'number'));
  const typeOf = (c: string) => {
    const v = shown.find((r) => r[c] != null)?.[c];
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'date';
    return 'varchar';
  };
  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className={numCols.has(c) ? 'num' : ''}>
                {c}
                {measures && <span className="col-type"> {typeOf(c)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const num = numCols.has(c);
                const cls = [num ? 'num' : '', measures && num ? 'measure' : ''].filter(Boolean).join(' ');
                return (
                  <td key={c} className={cls}>
                    {fmt(r[c])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small">
        {rows.length > MAX ? `mostrando ${MAX} de ${rows.length} linha(s) — use LIMIT para refinar` : `${rows.length} linha(s)`}
      </div>
    </div>
  );
}

function fmt(v: any) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}
