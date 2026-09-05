import { useEffect, useRef, useState } from 'react';
import { runQuery } from '../../api';
import type { DimRef } from '../../builder/types';

// Popover de filtro: lista valores distintos (até 200) com checkboxes + campo livre.
export default function FilterPopover({
  project,
  dim,
  current,
  anchorRect,
  onApply,
  onClose,
}: {
  project: string;
  dim: DimRef;
  current: string[];
  anchorRect: { top: number; left: number };
  onApply: (values: string[]) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set(current));
  const [free, setFree] = useState('');
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await runQuery(`select distinct "${dim.column}" as v from "${dim.table}" order by 1 limit 200`, project);
      if (!cancelled) {
        setValues((r.rows || []).map((x: any) => String(x.v)));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dim.table, dim.column]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  function toggle(v: string) {
    setChecked((p) => {
      const n = new Set(p);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }

  function apply() {
    const all = new Set(checked);
    for (const f of free.split(',').map((s) => s.trim()).filter(Boolean)) all.add(f);
    onApply([...all]);
  }

  const shown = search ? values.filter((v) => v.toLowerCase().includes(search.toLowerCase())) : values;

  return (
    <div className="filter-pop" ref={ref} style={{ top: anchorRect.top, left: anchorRect.left }}>
      <div className="filter-pop-head">
        filtro: <b>{dim.column}</b>
      </div>
      <input placeholder="buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="filter-pop-list">
        {loading && <div className="muted small">carregando valores…</div>}
        {!loading && shown.length === 0 && <div className="muted small">sem valores</div>}
        {shown.map((v) => (
          <label key={v} className="filter-pop-item">
            <input type="checkbox" checked={checked.has(v)} onChange={() => toggle(v)} /> {v}
          </label>
        ))}
      </div>
      <input
        placeholder="valor livre (separe com vírgula)"
        value={free}
        onChange={(e) => setFree(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
      />
      <div className="filter-pop-actions">
        <button onClick={() => onApply([])}>Limpar</button>
        <button className="run" onClick={apply}>
          Aplicar
        </button>
      </div>
    </div>
  );
}
