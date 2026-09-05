import { useLayoutEffect, useRef, useState } from 'react';
import EntityBox from './EntityBox';
import type { Agg, BuilderModel, DimRef, Selections } from '../../builder/types';

type Line = { x1: number; y1: number; x2: number; y2: number; label: string; active: boolean };

// Canvas do builder: fato no centro, dimensões alternando esquerda/direita,
// linhas de join em SVG (sólida = tabela em uso, tracejada = disponível).
export default function Canvas({
  model,
  sel,
  onToggleAttr,
  onToggleMeasure,
  onSetAgg,
  onOpenFilter,
  onRemoveFilter,
}: {
  model: BuilderModel;
  sel: Selections;
  onToggleAttr: (ref: DimRef) => void;
  onToggleMeasure: (col: string) => void;
  onSetAgg: (col: string, agg: Agg) => void;
  onOpenFilter: (ref: DimRef, anchor: HTMLElement) => void;
  onRemoveFilter: (ref: DimRef) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);

  const setBoxRef = (name: string) => (el: HTMLDivElement | null) => {
    if (el) boxRefs.current.set(name, el);
    else boxRefs.current.delete(name);
  };

  const usedTables = new Set<string>([
    ...sel.groupBy.map((g) => g.table),
    ...sel.filters.map((f) => f.table),
  ]);

  // Mede as caixas e calcula as linhas; refaz em mudanças de modelo/seleção e resize.
  useLayoutEffect(() => {
    function measure() {
      const cont = containerRef.current;
      const factEl = boxRefs.current.get(model.fact.name);
      if (!cont || !factEl) return;
      const cRect = cont.getBoundingClientRect();
      const fRect = factEl.getBoundingClientRect();
      const out: Line[] = [];
      for (const r of model.related) {
        const el = boxRefs.current.get(r.table);
        if (!el) continue;
        const dRect = el.getBoundingClientRect();
        const dimLeftOfFact = dRect.left < fRect.left;
        const x1 = (dimLeftOfFact ? fRect.left : fRect.right) - cRect.left;
        const y1 = fRect.top + fRect.height / 2 - cRect.top;
        const x2 = (dimLeftOfFact ? dRect.right : dRect.left) - cRect.left;
        const y2 = dRect.top + Math.min(dRect.height / 2, 60) - cRect.top;
        const keys = r.join.on.map((j) => j.factCol);
        const label = keys.length > 1 ? keys[0] + ' (+' + (keys.length - 1) + ')' : keys[0];
        out.push({ x1, y1, x2, y2, label, active: usedTables.has(r.table) });
      }
      setLines(out);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, sel]);

  const left = model.related.filter((_, i) => i % 2 === 0);
  const right = model.related.filter((_, i) => i % 2 === 1);

  const boxProps = { sel, onToggleAttr, onToggleMeasure, onSetAgg, onOpenFilter, onRemoveFilter };

  return (
    <div className="builder-canvas" ref={containerRef}>
      <svg className="builder-lines">
        {lines.map((l, i) => (
          <g key={i}>
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              className={l.active ? 'join-line active' : 'join-line'}
            />
            <text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2 - 5} className="join-label" textAnchor="middle">
              {l.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="builder-col">
        {left.map((r) => (
          <EntityBox key={r.table} table={r.table} icon="◳" attrs={r.attrs} boxRef={setBoxRef(r.table)} {...boxProps} />
        ))}
      </div>
      <div className="builder-col center">
        <EntityBox
          table={model.fact.name}
          icon="⊞"
          isFact
          measures={model.measures}
          attrs={model.factAttrs}
          boxRef={setBoxRef(model.fact.name)}
          {...boxProps}
        />
      </div>
      <div className="builder-col">
        {right.map((r) => (
          <EntityBox key={r.table} table={r.table} icon="◳" attrs={r.attrs} boxRef={setBoxRef(r.table)} {...boxProps} />
        ))}
      </div>

      {sel.filters.length > 0 && (
        <div className="builder-filters">
          {sel.filters.map((f, i) => (
            <span key={i} className="filter-chip">
              ⏷ {f.table === model.fact.name ? '' : f.table + '.'}
              {f.column} = {f.values.join(', ')}
              <button onClick={() => onRemoveFilter({ table: f.table, column: f.column })}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
