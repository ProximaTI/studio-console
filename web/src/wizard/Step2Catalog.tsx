import { useEffect, useState } from 'react';
import { jget, jpost } from '../api';
import { validateCatalogProposal } from './catalogAgent';
import type { CatSel } from './vbState';

// Passo 2 sobre FONTE SEMÂNTICA (F3): o analista escolhe métricas e dimensões
// do catálogo — rótulos e formatos vêm prontos do modelo; nada de coluna crua.
// ✨ agente (papel analista): proposta validada contra o catálogo; fora dele =
// rejeitada e re-pedida. SQL jamais transita.
export default function Step2Catalog({
  catalog,
  catSel,
  onChange,
  project,
}: {
  catalog: any;
  catSel: CatSel;
  onChange: (next: CatSel) => void;
  /** Projeto dono do catálogo — o server resolve o modelo por NOME (D22). */
  project?: string;
}) {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [nl, setNl] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  useEffect(() => {
    jget('/ai/status').then((d) => setAiEnabled(!!d.enabled)).catch(() => {});
  }, []);

  async function montar() {
    if (!nl.trim() || aiBusy) return;
    setAiBusy(true);
    setAiNote('');
    // D22: manda projeto+nome — o server carrega o catálogo REAL (o objeto
    // local segue só para validar a proposta client-side).
    const r = await jpost('/ai/nl-query', project ? { text: nl, project, model: catalog.model } : { text: nl, catalog });
    setAiBusy(false);
    if (r.error) {
      setAiNote('⚠ ' + r.error);
      return;
    }
    const v = validateCatalogProposal(catalog, r);
    if (!v.ok) {
      setAiNote(`⚠ proposta fora do catálogo rejeitada (${v.rejected.join(', ') || 'vazia'}) — refine o pedido.` + (r.note ? ' · ' + r.note : ''));
      return; // não aplica nada — re-pedida
    }
    onChange(v.catSel);
    if (r.note) setAiNote(r.note);
  }
  const metrics = Object.entries(catalog.metrics || {}) as [string, any][];
  const dims = Object.entries(catalog.dimensions || {}) as [string, any][];

  const toggleMetric = (name: string) =>
    onChange({
      ...catSel,
      metrics: catSel.metrics.includes(name) ? catSel.metrics.filter((m) => m !== name) : [...catSel.metrics, name],
    });

  const dimSel = (name: string) => catSel.dims.find((d) => d.dim === name);
  const toggleDim = (name: string, level?: string) => {
    const others = catSel.dims.filter((d) => d.dim !== name);
    const cur = dimSel(name);
    if (cur && cur.level === level) onChange({ ...catSel, dims: others }); // clique repetido = remove
    else onChange({ ...catSel, dims: [...others, { dim: name, ...(level ? { level } : {}) }] });
  };

  return (
    <div className="wiz-step">
      {/* Sempre visível (descoberta): sem agente configurado fica desabilitada
          com a dica — mesmo padrão do ✨ das células do notebook. */}
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          style={{ flex: 1, minWidth: 320 }}
          placeholder={
            aiEnabled
              ? '✨ descreva… ex.: "faturamento e % do total por unidade, por ano"'
              : '✨ pergunte em português ao catálogo — configure o agente em Settings › Agente (LM Studio ou Anthropic)'
          }
          value={nl}
          disabled={!aiEnabled}
          onChange={(e) => setNl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && montar()}
        />
        <button
          className="publish-app"
          onClick={montar}
          disabled={!aiEnabled || aiBusy || !nl.trim()}
          title={aiEnabled ? 'A proposta é validada contra o catálogo — SQL jamais vem da IA' : 'Configure o agente em Settings › Agente'}
        >
          {aiBusy ? 'Montando…' : '✨ Montar seleção'}
        </button>
      </div>
      {aiNote && <p className="muted small" style={{ marginTop: 0 }}>{aiNote}</p>}
      <div className="wiz-cat">
        <div>
          <div className="eyebrow">Métricas do modelo</div>
          {metrics.map(([name, m]) => (
            <label key={name} className="wiz-cat-item">
              <input type="checkbox" checked={catSel.metrics.includes(name)} onChange={() => toggleMetric(name)} />
              <b>{m.label || name}</b>
              <span className="mono small muted">
                {m.derived ? 'derived' : `${m.agg}(${m.column})`}
                {m.fmt ? ` · ${m.fmt}` : ''}
              </span>
            </label>
          ))}
        </div>
        <div>
          <div className="eyebrow">Dimensões do modelo</div>
          {dims.map(([name, d]) => {
            const cur = dimSel(name);
            return (
              <div key={name} className={'wiz-cat-item dim' + (cur ? ' on' : '')}>
                <input type="checkbox" checked={!!cur} onChange={() => toggleDim(name, d.hierarchy ? d.hierarchy[0] : undefined)} />
                <b>{d.label || name}</b>
                {d.pii && <span className="pj-badge" title="dimensão sensível — políticas de publish aplicam">pii</span>}
                {Array.isArray(d.hierarchy) ? (
                  <span className="wiz-cat-levels">
                    {d.hierarchy.map((lv: string) => (
                      <button
                        key={lv}
                        type="button"
                        className={'param-chip' + (cur?.level === lv ? ' on' : '')}
                        onClick={() => toggleDim(name, lv)}
                      >
                        {lv}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="mono small muted">{(d.columns || [d.column]).join(', ')}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="muted small">
        {catSel.metrics.length} métrica(s) · {catSel.dims.length} dimensão(ões) — governança por adoção: o SQL sai do
        catálogo, com joins declarados e proveniência.
      </p>
    </div>
  );
}
