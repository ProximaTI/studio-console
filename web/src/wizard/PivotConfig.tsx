import { useState } from 'react';
import { runQuery } from '../api';
import { ctePrefix } from './vbState';
import type { WizardSource } from './vbState';
import type { Agg, SourceInfo } from '../builder/types';

export type PivotSpec = {
  rows: string[];
  cols: string;
  measure: { column: string; agg: Agg };
  frozenCols: string[];
  others: boolean;
};

const AGGS: Agg[] = ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'];

// Sub-etapa do Pivot (spec §5): linhas × colunas × métrica — a ordem importa.
// "↻ Congelar/Recalcular colunas" roda SELECT DISTINCT e grava o domínio no
// marcador: filtros mudam valores, nunca o conjunto de colunas.
export default function PivotConfig({
  project,
  source,
  sourceInfo,
  pivot,
  onChange,
}: {
  project: string;
  source: WizardSource;
  sourceInfo: SourceInfo;
  pivot: PivotSpec | null;
  onChange: (next: PivotSpec) => void;
}) {
  const cols = sourceInfo.columns.map((c) => c.name);
  const p: PivotSpec = pivot || { rows: [], cols: '', measure: { column: cols[0] || '', agg: 'count' }, frozenCols: [], others: true };
  const [freezing, setFreezing] = useState(false);
  const [err, setErr] = useState('');

  const set = (patch: Partial<PivotSpec>) => onChange({ ...p, ...patch });

  const toggleRow = (c: string) =>
    set({ rows: p.rows.includes(c) ? p.rows.filter((x) => x !== c) : [...p.rows, c] });

  async function freeze() {
    if (!p.cols) return;
    setFreezing(true);
    setErr('');
    const sql =
      ctePrefix(source) +
      `select distinct cast("${p.cols.replace(/"/g, '')}" as varchar) as v\nfrom "${source.name.replace(/"/g, '')}"\nwhere "${p.cols.replace(/"/g, '')}" is not null\norder by 1\nlimit 50`;
    const r = await runQuery(sql, project);
    setFreezing(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    set({ frozenCols: (r.rows || []).map((x: any) => String(x.v)) });
  }

  return (
    <div className="wiz-roles">
      <div className="eyebrow">Pivot · linhas × colunas × métrica (a ordem importa)</div>
      <div className="wiz-roles-grid" style={{ marginTop: 10 }}>
        <label>
          linhas (≥1, na ordem do clique)
          <div className="wiz-pivot-rows">
            {cols.map((c) => (
              <button
                key={c}
                type="button"
                className={'param-chip' + (p.rows.includes(c) ? ' on' : '')}
                onClick={() => toggleRow(c)}
                title={p.rows.includes(c) ? 'posição ' + (p.rows.indexOf(c) + 1) : 'adicionar às linhas'}
              >
                {p.rows.includes(c) ? `${p.rows.indexOf(c) + 1}· ` : ''}
                {c}
              </button>
            ))}
          </div>
        </label>
        <label>
          colunas (dimensão pivotada)
          <select value={p.cols} onChange={(e) => set({ cols: e.target.value, frozenCols: [] })}>
            <option value="">—</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          métrica (célula)
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={p.measure.agg} onChange={(e) => set({ measure: { ...p.measure, agg: e.target.value as Agg } })}>
              {AGGS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select value={p.measure.column} onChange={(e) => set({ measure: { ...p.measure, column: e.target.value } })}>
              {cols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" onClick={freeze} disabled={!p.cols || freezing}>
          {freezing ? 'Congelando…' : '↻ ' + (p.frozenCols.length ? 'Recalcular colunas' : 'Congelar colunas')}
        </button>
        <label style={{ margin: 0 }}>
          <input type="checkbox" checked={p.others !== false} onChange={(e) => set({ others: e.target.checked })} />
          "Outros" agrega valores fora da lista (não perde dados)
        </label>
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {p.frozenCols.length > 0 && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          {p.frozenCols.length} coluna(s) congeladas no marcador: {p.frozenCols.slice(0, 8).join(' · ')}
          {p.frozenCols.length > 8 ? ' …' : ''} — filtros mudam valores, nunca o conjunto de colunas.
        </p>
      )}
    </div>
  );
}
