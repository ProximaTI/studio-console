import type { SourceInfo, VbParam } from '../builder/types';

// Passo 3 — Argumentos (retrieval arguments): declaração {nome, tipo, origem,
// default} PRIMEIRO; o input é derivado pelo compilador. O tipo determina o
// input E o predicado: enum→Dropdown LIKE · texto→TextInput LIKE ·
// número→Slider ≥ (limiar mínimo) · data→DateRange BETWEEN.
const TYPES: { id: VbParam['type']; label: string; enabled: boolean; why?: string }[] = [
  { id: 'enum', label: 'enum → Dropdown', enabled: true },
  { id: 'text', label: 'texto → TextInput', enabled: true },
  { id: 'number', label: 'número → Slider (≥)', enabled: true },
  { id: 'date', label: 'data → DateRange', enabled: true },
];

export default function Step3Params({
  sourceInfo,
  params,
  onChange,
  fromOptions,
}: {
  sourceInfo: SourceInfo;
  params: VbParam[];
  onChange: (next: VbParam[]) => void;
  /** Fonte semântica: origem = dimensões/níveis do catálogo (não colunas cruas). */
  fromOptions?: string[];
}) {
  const cols = fromOptions ?? sourceInfo.columns.map((c) => c.name);

  function add() {
    const col = cols[0] || '';
    onChange([...params, { name: col || 'arg' + (params.length + 1), type: 'enum', from: col, default: '%', label: '' }]);
  }
  const patch = (i: number, p: Partial<VbParam>) => onChange(params.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const remove = (i: number) => onChange(params.filter((_, j) => j !== i));

  return (
    <div className="wiz-step">
      <p className="muted small" style={{ marginTop: 0 }}>
        Cada argumento vira um input na página e um predicado no SQL — sem edição manual. Default “%” = Todos.
      </p>
      {params.map((p, i) => (
        <div key={i} className="wiz-param">
          <label>
            nome
            <input value={p.name} onChange={(e) => patch(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })} style={{ width: 120 }} />
          </label>
          <label>
            tipo
            <select
              value={p.type}
              onChange={(e) => patch(i, { type: e.target.value as VbParam['type'] })}
            >
              {TYPES.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.enabled} title={t.why}>
                  {t.label}
                  {!t.enabled ? ' (em breve)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            origem (coluna)
            <select value={p.from} onChange={(e) => patch(i, { from: e.target.value })}>
              {cols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {p.type !== 'date' && (
            <label>
              default
              <input value={p.default ?? '%'} onChange={(e) => patch(i, { default: e.target.value })} style={{ width: 70 }} title='"%" = Todos (enum/texto)' />
            </label>
          )}
          {p.type === 'number' && (
            <>
              <label>
                min
                <input type="number" value={p.min ?? 0} onChange={(e) => patch(i, { min: Number(e.target.value) })} style={{ width: 70 }} />
              </label>
              <label>
                max
                <input type="number" value={p.max ?? 100} onChange={(e) => patch(i, { max: Number(e.target.value) })} style={{ width: 70 }} />
              </label>
              <label>
                step
                <input type="number" value={p.step ?? 1} onChange={(e) => patch(i, { step: Number(e.target.value) })} style={{ width: 60 }} />
              </label>
            </>
          )}
          <label>
            rótulo
            <input value={p.label ?? ''} placeholder={p.name} onChange={(e) => patch(i, { label: e.target.value })} style={{ width: 140 }} />
          </label>
          <button onClick={() => remove(i)} title="Remover argumento">
            ✕
          </button>
        </div>
      ))}
      <button onClick={add} style={{ marginTop: 8 }}>
        ＋ Argumento
      </button>
    </div>
  );
}
