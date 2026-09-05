import type { Col, DimRef, Filter, Measure, Selections } from '../../builder/types';
import type { Agg } from '../../builder/types';

const AGG_LABEL: Record<Agg, string> = { sum: 'soma', avg: 'média', count: 'contagem', count_distinct: 'contagem distinta', min: 'mín', max: 'máx' };

// Caixa de entidade do canvas: fato (medidas Σ + atributos) ou dimensão (atributos).
// Clique no atributo = toggle no GROUP BY; Σ = toggle da medida; funil = popover de filtro.
export default function EntityBox({
  table,
  icon,
  isFact,
  measures,
  attrs,
  sel,
  onToggleAttr,
  onToggleMeasure,
  onSetAgg,
  onOpenFilter,
  onRemoveFilter,
  boxRef,
}: {
  table: string;
  icon: string;
  isFact?: boolean;
  measures?: Col[];
  attrs: Col[];
  sel: Selections;
  onToggleAttr: (ref: DimRef) => void;
  onToggleMeasure: (col: string) => void;
  onSetAgg: (col: string, agg: Agg) => void;
  onOpenFilter: (ref: DimRef, anchor: HTMLElement) => void;
  onRemoveFilter: (ref: DimRef) => void;
  boxRef: (el: HTMLDivElement | null) => void;
}) {
  const isGrouped = (c: string) => sel.groupBy.some((g) => g.table === table && g.column === c);
  const measureOf = (c: string): Measure | undefined => sel.measures.find((m) => m.column === c);
  const filterOf = (c: string): Filter | undefined => sel.filters.find((f) => f.table === table && f.column === c);

  return (
    <div className={'entity-box' + (isFact ? ' fact' : '')} ref={boxRef}>
      <div className="entity-title">
        {icon} {table}
        {isFact && <span className="entity-tag">fato</span>}
      </div>

      {(measures || []).map((c) => {
        const m = measureOf(c.name);
        return (
          <div key={c.name} className={'attr measure' + (m ? ' on' : '')}>
            <span className="attr-label" onClick={() => onToggleMeasure(c.name)}>
              Σ {m ? `${c.name} — ${AGG_LABEL[m.agg]}` : c.name}
            </span>
            {m && (
              <select
                className="agg-select"
                value={m.agg}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onSetAgg(c.name, e.target.value as Agg)}
              >
                {(Object.keys(AGG_LABEL) as Agg[]).map((a) => (
                  <option key={a} value={a}>
                    {AGG_LABEL[a]}
                  </option>
                ))}
              </select>
            )}
            {m && <span className="attr-check">✓</span>}
          </div>
        );
      })}

      {attrs.map((c) => {
        const f = filterOf(c.name);
        return (
          <div key={c.name} className={'attr' + (isGrouped(c.name) ? ' on' : '') + (f ? ' filtered' : '')}>
            <span className="attr-label" onClick={() => onToggleAttr({ table, column: c.name })}>
              {f ? `${c.name} = ${f.values.slice(0, 2).join(', ')}${f.values.length > 2 ? '…' : ''}` : c.name}
            </span>
            <button
              className="attr-filter"
              title={f ? 'Editar filtro' : 'Filtrar valores'}
              onClick={(e) => onOpenFilter({ table, column: c.name }, e.currentTarget)}
            >
              ⏷
            </button>
            {f && (
              <button className="attr-filter" title="Remover filtro" onClick={() => onRemoveFilter({ table, column: c.name })}>
                ✕
              </button>
            )}
            {isGrouped(c.name) && <span className="attr-check">✓</span>}
          </div>
        );
      })}
    </div>
  );
}
