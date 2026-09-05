// Sub-etapa do Nested (F3 §5.3): divide as dimensões selecionadas em grão-PAI
// e grão-FILHO e escolhe o estilo do filho (qualquer estilo de query única).
export type NestedSpec = { parent: string[]; child: string[]; childStyle: string; limitPerGroup: number; maxGroups?: number };

export default function NestedConfig({
  dims,
  nested,
  onChange,
}: {
  /** Aliases das dimensões selecionadas no Passo 2 (raw ou catálogo). */
  dims: string[];
  nested: NestedSpec | null;
  onChange: (next: NestedSpec) => void;
}) {
  const n: NestedSpec = nested || { parent: [], child: [], childStyle: 'tabular', limitPerGroup: 10, maxGroups: 50 };
  const set = (patch: Partial<NestedSpec>) => onChange({ ...n, ...patch });

  const roleOf = (d: string) => (n.parent.includes(d) ? 'pai' : n.child.includes(d) ? 'filho' : '—');
  const cycle = (d: string) => {
    const parent = n.parent.filter((x) => x !== d);
    const child = n.child.filter((x) => x !== d);
    const cur = roleOf(d);
    if (cur === '—') set({ parent: [...parent, d], child });
    else if (cur === 'pai') set({ parent, child: [...child, d] });
    else set({ parent, child });
  };

  return (
    <div className="wiz-roles">
      <div className="eyebrow">Nested · divisão pai → filho (1 query, nunca N+1)</div>
      <div className="wiz-pivot-rows" style={{ margin: '10px 0' }}>
        {dims.map((d) => (
          <button key={d} type="button" className={'param-chip' + (roleOf(d) !== '—' ? ' on' : '')} onClick={() => cycle(d)} title="clique alterna: — → pai → filho">
            {d} {roleOf(d) !== '—' ? `· ${roleOf(d)}` : ''}
          </button>
        ))}
        {dims.length < 2 && <span className="muted small">selecione ≥2 dimensões no Passo 2</span>}
      </div>
      <div className="wiz-roles-grid">
        <label>
          estilo do filho
          <select value={n.childStyle} onChange={(e) => set({ childStyle: e.target.value })}>
            <option value="tabular">tabular</option>
            <option value="graph.bar">graph.bar</option>
            <option value="graph.line">graph.line</option>
          </select>
        </label>
        <label>
          top-N por grupo
          <input type="number" min={1} value={n.limitPerGroup} onChange={(e) => set({ limitPerGroup: Math.max(1, Number(e.target.value) || 10) })} />
        </label>
        <label>
          maxGroups
          <input type="number" min={1} value={n.maxGroups ?? 50} onChange={(e) => set({ maxGroups: Math.max(1, Number(e.target.value) || 50) })} />
        </label>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Trocar o estilo do filho depois NÃO re-executa a query — só a tag muda (▣).
      </p>
    </div>
  );
}
