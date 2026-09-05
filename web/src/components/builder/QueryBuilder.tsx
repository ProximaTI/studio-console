import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Canvas from './Canvas';
import FilterPopover from './FilterPopover';
import ResultsGrid from '../ResultsGrid';
import { jput, runQuery } from '../../api';
import { promptDialog } from '../dialogs';
import { buildModel } from '../../builder/infer';
import { buildSql } from '../../builder/sqlgen';
import { aiStatus, montarConsulta } from '../../builder/nl';
import { buildEvidenceMd, defaultPageName } from '../../builder/evidencePage';
import { EMPTY_SEL } from '../../builder/types';
import type { Agg, DimRef, Selections, SourceInfo } from '../../builder/types';

// Builder visual de SQL, embutido no SQL Console (modo "✨ Builder visual").
// Seleções no canvas -> SQL determinístico; "✨ Montar consulta" usa a Claude API
// (via servidor) apenas para mapear texto -> seleções.
export default function QueryBuilder({
  project,
  sources,
  onSendSql,
}: {
  /** Projeto dono das fontes — as consultas rodam no schema dele. */
  project: string;
  sources: SourceInfo[];
  onSendSql: (sql: string) => void;
}) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [factName, setFactName] = useState('');
  const [sel, setSel] = useState<Selections>(EMPTY_SEL);
  const [popover, setPopover] = useState<{ dim: DimRef; top: number; left: number } | null>(null);
  const [nlText, setNlText] = useState('');
  const [ai, setAi] = useState<{ enabled: boolean; provider?: string; model?: string; baseUrl?: string }>({ enabled: false });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [res, setRes] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const pendingPrompt = useRef<string | null>(null);

  useEffect(() => {
    aiStatus().then(setAi);
    // Prompt vindo da Home ("Montar relatório"): pré-preenche e roda quando o modelo estiver pronto.
    const p = localStorage.getItem('studio.agentPrompt');
    if (p) {
      localStorage.removeItem('studio.agentPrompt');
      setNlText(p);
      pendingPrompt.current = p;
    }
  }, []);

  // fato default: 1ª fonte com cara de fato (mais colunas numéricas)
  useEffect(() => {
    if (factName || sources.length === 0) return;
    const best = [...sources].sort(
      (a, b) => b.columns.filter((c) => /INT|DOUBLE/i.test(c.type)).length - a.columns.filter((c) => /INT|DOUBLE/i.test(c.type)).length
    )[0];
    setFactName(best.name);
  }, [sources, factName]);

  const model = useMemo(() => (factName ? buildModel(sources, factName) : null), [sources, factName]);
  const sql = useMemo(() => (model ? buildSql(model, sel) : ''), [model, sel]);

  function changeFact(name: string) {
    setFactName(name);
    setSel(EMPTY_SEL);
    setRes(null);
    setAiNote('');
  }

  const toggleAttr = (ref: DimRef) =>
    setSel((p) => {
      const has = p.groupBy.some((g) => g.table === ref.table && g.column === ref.column);
      return { ...p, groupBy: has ? p.groupBy.filter((g) => !(g.table === ref.table && g.column === ref.column)) : [...p.groupBy, ref] };
    });

  const toggleMeasure = (col: string) =>
    setSel((p) => {
      const has = p.measures.some((m) => m.column === col);
      return { ...p, measures: has ? p.measures.filter((m) => m.column !== col) : [...p.measures, { column: col, agg: 'sum' as Agg }] };
    });

  const setAgg = (col: string, agg: Agg) =>
    setSel((p) => ({ ...p, measures: p.measures.map((m) => (m.column === col ? { ...m, agg } : m)) }));

  function openFilter(ref: DimRef, anchor: HTMLElement) {
    const wrap = rootRef.current!.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    setPopover({
      dim: ref,
      top: r.bottom - wrap.top + 6,
      left: Math.max(8, Math.min(r.left - wrap.left, wrap.width - 300)),
    });
  }

  const removeFilter = (ref: DimRef) =>
    setSel((p) => ({ ...p, filters: p.filters.filter((f) => !(f.table === ref.table && f.column === ref.column)) }));

  function applyFilter(values: string[]) {
    if (!popover) return;
    const { dim } = popover;
    setSel((p) => {
      const others = p.filters.filter((f) => !(f.table === dim.table && f.column === dim.column));
      return { ...p, filters: values.length ? [...others, { table: dim.table, column: dim.column, values }] : others };
    });
    setPopover(null);
  }

  // Dispara o prompt pendente da Home assim que o modelo (fato + dimensões) existir.
  useEffect(() => {
    if (model && ai.enabled && pendingPrompt.current) {
      const p = pendingPrompt.current;
      pendingPrompt.current = null;
      runMontar(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, ai.enabled]);

  async function runMontar(text?: string) {
    const q = (text ?? nlText).trim();
    if (!model || !q) return;
    setAiBusy(true);
    setAiNote('');
    const r = await montarConsulta(q, model, sel.limit);
    setAiBusy(false);
    if (r.error) {
      setAiNote('⚠ ' + r.error);
      return;
    }
    if (r.sel) setSel(r.sel);
    if (r.note) setAiNote(r.note);
  }

  async function executar() {
    if (!sql) return;
    setRunning(true);
    setRes(await runQuery(sql, project));
    setRunning(false);
  }

  // Cria o .md em pages/ DESTE projeto e abre o editor nele.
  async function criarPagina() {
    if (!model) return;
    const name = await promptDialog('Nome da página (.md):', {
      title: 'Criar página em ' + project,
      defaultValue: defaultPageName(model, sel),
    });
    if (!name) return;
    const path = (name.endsWith('.md') ? name : name + '.md').replace(/[^a-zA-Z0-9_/.-]/g, '_');
    await jput('/projects/' + project + '/file', { path, content: buildEvidenceMd(sql, sel, model) });
    localStorage.setItem('studio.file.' + project, path);
    navigate('/projects/' + project);
  }

  return (
    <div className="qbuilder" ref={rootRef}>
      <div className="qb-bar">
        <input
          className="qb-nl"
          placeholder='descreva a consulta… ex.: "faturamento por serviço em 2025, só a unidade Batel"'
          value={nlText}
          onChange={(e) => setNlText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runMontar()}
          disabled={!ai.enabled}
        />
        <button
          className="publish-app"
          onClick={() => runMontar()}
          disabled={!ai.enabled || aiBusy || !nlText.trim()}
          title={
            ai.enabled
              ? `Agente: ${ai.provider === 'anthropic' ? 'Anthropic' : 'local'} · ${ai.model}${ai.baseUrl ? ' @ ' + ai.baseUrl : ''}`
              : 'Configure o agente em Settings › Agente (LM Studio local ou Anthropic)'
          }
        >
          {aiBusy ? 'Montando…' : '✨ Montar consulta'}
        </button>
        <label className="qb-schema">
          Modelo/schema (fato):
          <select value={factName} onChange={(e) => changeFact(e.target.value)}>
            {sources.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!ai.enabled && (
        <div className="muted small qb-note">
          ✨ desabilitado: configure o agente em <b>Settings › Agente</b> (servidor local LM Studio/vLLM/LiteLLM ou Anthropic).
        </div>
      )}
      {aiNote && <div className="muted small qb-note">{aiNote}</div>}

      {model && (
        <Canvas
          model={model}
          sel={sel}
          onToggleAttr={toggleAttr}
          onToggleMeasure={toggleMeasure}
          onSetAgg={setAgg}
          onOpenFilter={openFilter}
          onRemoveFilter={removeFilter}
        />
      )}

      <div className="qb-sql">
        <div className="qb-sql-head">SQL gerado (determinístico, a partir das seleções)</div>
        <pre>{sql || '— selecione medidas e atributos no canvas —'}</pre>
      </div>

      <div className="qb-actions">
        <label>
          Limite
          <input
            type="number"
            min={1}
            value={sel.limit}
            onChange={(e) => setSel((p) => ({ ...p, limit: Number(e.target.value) || 100 }))}
            style={{ width: 80 }}
          />
        </label>
        <span className="nb-spacer" />
        <button onClick={() => onSendSql(sql)} disabled={!sql} title="Enviar o SQL para o editor do console">
          ↪ Editor
        </button>
        <button className="run" onClick={executar} disabled={!sql || running}>
          {running ? 'Rodando…' : '▶ Executar'}
        </button>
        <button className="publish" onClick={criarPagina} disabled={!sql}>
          ⎘ Criar página Evidence
        </button>
      </div>

      {res && <ResultsGrid columns={res.columns} rows={res.rows} error={res.error} />}

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
