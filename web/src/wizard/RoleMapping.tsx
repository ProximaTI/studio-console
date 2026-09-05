import type { SourceInfo } from '../builder/types';

// Sub-etapa papel→coluna (spec §5 Passo 4): estilos com papéis (ConnectionMap,
// CollaborationGraph) mapeiam colunas da fonte para os papéis do contrato.
// Reusada na troca para estilo incompatível — a seleção não é descartada.
export default function RoleMapping({
  styleDef,
  sourceInfo,
  roles,
  onChange,
}: {
  styleDef: { id: string; label: string; roles: { key: string; label: string; accepts: string; optional?: boolean }[] };
  sourceInfo: SourceInfo;
  roles: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const set = (key: string, value: string) => {
    const next = { ...roles };
    if (value) next[key] = value;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="wiz-roles">
      <div className="eyebrow">Papéis → colunas · {styleDef.label}</div>
      <div className="wiz-roles-grid">
        {styleDef.roles.map((role) => (
          <label key={role.key}>
            {role.label}
            {role.optional ? ' (opcional)' : ''}
            <select value={roles[role.key] || ''} onChange={(e) => set(role.key, e.target.value)}>
              <option value="">—</option>
              {sourceInfo.columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} · {String(c.type).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        ))}
        {styleDef.id === 'connectionmap' && (
          <label>
            mapa
            <select value={roles.map || 'world'} onChange={(e) => set('map', e.target.value)}>
              <option value="world">world (mundo)</option>
              <option value="brazil">brazil (Brasil)</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
