import { useRef, useState } from 'react';
import Canvas from '../components/builder/Canvas';
import FilterPopover from '../components/builder/FilterPopover';
import type { Agg, BuilderModel, DimRef, Selections } from '../builder/types';

// Passo 2 — Seleção: o MESMO canvas do SQL Builder (dims, medidas Σ, filtros ⏷)
// operando sobre a fonte escolhida no Passo 1.
export default function Step2Select({
  project,
  model,
  sel,
  onChange,
}: {
  project: string;
  model: BuilderModel;
  sel: Selections;
  onChange: (next: Selections) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<{ dim: DimRef; top: number; left: number } | null>(null);

  const toggleAttr = (ref: DimRef) => {
    const has = sel.groupBy.some((g) => g.table === ref.table && g.column === ref.column);
    onChange({ ...sel, groupBy: has ? sel.groupBy.filter((g) => !(g.table === ref.table && g.column === ref.column)) : [...sel.groupBy, ref] });
  };
  const toggleMeasure = (col: string) => {
    const has = sel.measures.some((m) => m.column === col);
    onChange({ ...sel, measures: has ? sel.measures.filter((m) => m.column !== col) : [...sel.measures, { column: col, agg: 'sum' as Agg }] });
  };
  const setAgg = (col: string, agg: Agg) =>
    onChange({ ...sel, measures: sel.measures.map((m) => (m.column === col ? { ...m, agg } : m)) });
  const openFilter = (ref: DimRef, anchor: HTMLElement) => {
    const wrap = rootRef.current!.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    setPopover({ dim: ref, top: r.bottom - wrap.top + 6, left: Math.max(8, Math.min(r.left - wrap.left, wrap.width - 300)) });
  };
  const removeFilter = (ref: DimRef) =>
    onChange({ ...sel, filters: sel.filters.filter((f) => !(f.table === ref.table && f.column === ref.column)) });
  const applyFilter = (values: string[]) => {
    if (!popover) return;
    const { dim } = popover;
    const others = sel.filters.filter((f) => !(f.table === dim.table && f.column === dim.column));
    onChange({ ...sel, filters: values.length ? [...others, { table: dim.table, column: dim.column, values }] : others });
    setPopover(null);
  };

  return (
    <div className="wiz-step" ref={rootRef} style={{ position: 'relative' }}>
      <Canvas
        model={model}
        sel={sel}
        onToggleAttr={toggleAttr}
        onToggleMeasure={toggleMeasure}
        onSetAgg={setAgg}
        onOpenFilter={openFilter}
        onRemoveFilter={removeFilter}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <label>
          Limite
          <input
            type="number"
            min={1}
            value={sel.limit}
            onChange={(e) => onChange({ ...sel, limit: Math.max(1, Number(e.target.value) || 100) })}
            style={{ width: 90 }}
          />
        </label>
        <span className="muted small">
          {sel.groupBy.length} dimensão(ões) · {sel.measures.length} métrica(s) · {sel.filters.length} filtro(s)
        </span>
      </div>
      {popover && (
        <FilterPopover
          project={project}
          dim={popover.dim}
          current={sel.filters.find((f) => f.table === popover.dim.table && f.column === popover.dim.column)?.values || []}
          anchorRect={{ top: popover.top, left: popover.left }}
          onApply={applyFilter}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
