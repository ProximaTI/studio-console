import { STYLES } from '../../../shared/viewStyles.js';
import RoleMapping from './RoleMapping';
import PivotConfig from './PivotConfig';
import NestedConfig from './NestedConfig';
import type { WizardSource } from './vbState';
import type { SourceInfo } from '../builder/types';

// Passo 4 — Apresentação: galeria renderizada DO REGISTRO de estilos (nada
// hardcoded); cada card habilita/desabilita conforme requires() (contrato).
// Estilos com papéis ficam clicáveis mesmo sem mapeamento — clicar abre a
// sub-etapa papel→coluna, sem descartar a seleção (spec §5).
const GLYPH: Record<string, string> = {
  tabular: '▦',
  'graph.bar': '▮▮▮',
  'graph.line': '📈',
  group: '≣',
  freeform: '◱ ◲',
  connectionmap: '🌐',
  collabgraph: '🕸',
  areamap: '🗺',
  pivot: '⊞',
  nested: '▤▸',
};

export default function Step4Style({
  project,
  source,
  vbDraft,
  sourceInfo,
  style,
  roles,
  pivot,
  nested,
  dimAliases,
  onSelect,
  onRoles,
  onPivot,
  onNested,
}: {
  project: string;
  source: WizardSource;
  /** vb parcial {dims, metrics, params, roles, pivot} para o gating dos contratos. */
  vbDraft: any;
  sourceInfo: SourceInfo;
  style: string | null;
  roles: Record<string, string>;
  pivot: any;
  nested: any;
  /** Aliases das dims selecionadas (p/ divisão pai/filho do Nested). */
  dimAliases: string[];
  onSelect: (id: string) => void;
  onRoles: (next: Record<string, string>) => void;
  onPivot: (next: any) => void;
  onNested: (next: any) => void;
}) {
  const selectedDef: any = STYLES.find((s: any) => s.id === style);

  return (
    <div className="wiz-step">
      <div className="wiz-gallery">
        {STYLES.map((s: any) => {
          const r = s.requires(vbDraft, sourceInfo);
          const clickable = r.ok || r.needsRoles; // papéis pendentes: clica p/ mapear
          return (
            <button
              key={s.id}
              className={'wiz-style' + (style === s.id ? ' sel' : '') + (clickable ? '' : ' off')}
              disabled={!clickable}
              onClick={() => onSelect(s.id)}
              title={r.ok ? s.label : r.reason}
            >
              <span className="wiz-style-glyph">{GLYPH[s.id] || '▣'}</span>
              <b>{s.label}</b>
              {!r.ok && <span className="wiz-style-why">{r.reason}</span>}
            </button>
          );
        })}
      </div>

      {selectedDef?.roles && <RoleMapping styleDef={selectedDef} sourceInfo={sourceInfo} roles={roles} onChange={onRoles} />}
      {style === 'pivot' && (
        <PivotConfig project={project} source={source} sourceInfo={sourceInfo} pivot={pivot} onChange={onPivot} />
      )}
      {style === 'nested' && <NestedConfig dims={dimAliases} nested={nested} onChange={onNested} />}

      <p className="muted small">
        Trocar o estilo depois recompila SÓ o bloco (botão ▣ no notebook) — seleção e argumentos são preservados.
      </p>
    </div>
  );
}
