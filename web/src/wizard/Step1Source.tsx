import { useEffect, useState } from 'react';
import { jget } from '../api';
import type { WizardSource } from './vbState';
import { cteName } from './vbState';

// Passo 1 — Fonte: fontes do projeto (sources/), queries salvas (queries/*.sql)
// e models — os dois últimos entram como CTE (reuso composável, spec §5).
export default function Step1Source({
  project,
  selected,
  onSelect,
}: {
  project: string;
  selected: WizardSource | null;
  onSelect: (s: WizardSource) => void;
}) {
  const [sources, setSources] = useState<any[]>([]);
  const [queryFiles, setQueryFiles] = useState<string[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [semantic, setSemantic] = useState<any[]>([]);

  useEffect(() => {
    jget('/projects/' + project + '/sources').then((d) => setSources(d.sources || []));
    jget('/projects/' + project + '/query-files').then((d) => setQueryFiles(d.files || []));
    jget('/projects/' + project + '/models').then((d) => setModels(d.models || []));
    jget('/projects/' + project + '/semantic').then((d) => setSemantic((d.models || []).filter((m: any) => m.valid)));
  }, [project]);

  const isSel = (kind: string, key: string) => selected?.kind === kind && (selected.ref || selected.name) === key;

  async function pickQuery(file: string) {
    const d = await jget('/projects/' + project + '/query-file?path=' + encodeURIComponent(file));
    onSelect({ kind: 'query', name: cteName(file), ref: file, sql: d.content || '' });
  }

  return (
    <div className="wiz-step">
      {semantic.length > 0 && (
        <>
          <div className="eyebrow">Modelos semânticos (governados — métricas e rótulos prontos)</div>
          <div className="wiz-grid" style={{ marginBottom: 18 }}>
            {semantic.map((m) => (
              <button
                key={m.model}
                className={'wiz-card sem' + (isSel('semantic', m.model) ? ' sel' : '')}
                onClick={() => onSelect({ kind: 'semantic', name: m.model, ref: m.file })}
              >
                <b>◆ {m.label}</b>
                <span className="muted small">
                  {Object.keys(m.catalog?.metrics || {}).length} métricas · {Object.keys(m.catalog?.dimensions || {}).length} dims · @{m.hash}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="eyebrow">Fontes do projeto</div>
      <div className="wiz-grid">
        {sources.map((s) => (
          <button
            key={s.name}
            className={'wiz-card' + (isSel('source', s.name) ? ' sel' : '')}
            onClick={() => onSelect({ kind: 'source', name: s.name })}
          >
            <b>⛁ {s.name}</b>
            <span className="muted small">{(s.columns || []).length} colunas</span>
          </button>
        ))}
        {sources.length === 0 && <div className="muted small">Nenhuma fonte — suba um arquivo em Dados › Fontes.</div>}
      </div>

      <div className="eyebrow" style={{ marginTop: 18 }}>Queries salvas (viram CTE)</div>
      <div className="wiz-grid">
        {queryFiles.map((f) => (
          <button key={f} className={'wiz-card' + (isSel('query', f) ? ' sel' : '')} onClick={() => pickQuery(f)}>
            <b>🧮 {f}</b>
            <span className="muted small">queries/{f}</span>
          </button>
        ))}
        {queryFiles.length === 0 && <div className="muted small">Nenhuma query salva ainda.</div>}
      </div>

      <div className="eyebrow" style={{ marginTop: 18 }}>Models (viram CTE)</div>
      <div className="wiz-grid">
        {models.map((m) => (
          <button
            key={m.id}
            className={'wiz-card' + (isSel('model', m.id) ? ' sel' : '')}
            onClick={() => onSelect({ kind: 'model', name: cteName(m.id), ref: m.id, sql: m.sql || '' })}
          >
            <b>◈ {m.name}</b>
            <span className="muted small">{m.description || 'model do projeto'}</span>
          </button>
        ))}
        {models.length === 0 && <div className="muted small">Nenhum model ainda.</div>}
      </div>
    </div>
  );
}
