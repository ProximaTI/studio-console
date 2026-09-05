import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import MarkdownIt from 'markdown-it';
import { Cell, CellType, newId, parseCells, serializeCells, collectInputs } from './cells';
import { jget, runQuery } from '../api';
import { renderInline } from '../render/interpolate';
import ResultsGrid from '../components/ResultsGrid';
import { alertDialog, confirmDialog, formDialog } from '../components/dialogs';
import CellEditor from './CellEditor';
import CellAssistant from './CellAssistant';
import { useNotebookQueries } from './useNotebookQueries';
import { computeVbRanges, isMarkerOnlyCell } from './viewblocks';
import { stripViewblockMarkers, spliceViewblock } from '../../../shared/viewblock.js';
import { drillInfo, applyDrillDown, applyDrillUp, drillOptionsSql } from '../../../shared/drill.js';
import { recompileSemanticVb } from '../wizard/vbState';

const mdIt = new MarkdownIt({ html: false, linkify: true, breaks: false });

type ActiveEditor = { view: EditorView; cellType: CellType } | null;

// Editor estilo Jupyter-lab: células de Texto (Markdown), Código (SQL) e Raw.
// Edita o conteúdo do .md (controlado por `value`), notificando via onChange.
// `params` traz os valores dos parâmetros da página (templating estilo Evidence).
export default function Notebook({
  value,
  onChange,
  params = {},
  paramNames = [],
  project,
  onEditViewblock,
}: {
  value: string;
  onChange: (md: string) => void;
  params?: Record<string, any>;
  paramNames?: string[];
  /** Projeto dono da página — queries e fontes vêm do schema dele. */
  project?: string;
  /** Reabre um passo do wizard para o bloco (2=Seleção, 3=Argumentos, 4=Apresentação). */
  onEditViewblock?: (vbId: string, step: 2 | 3 | 4) => void;
}) {
  const [cells, setCells] = useState<Cell[]>(() => parseCells(value));
  const [edited, setEdited] = useState<Record<string, boolean>>({}); // células texto em modo edição
  const [inputs, setInputs] = useState<Record<string, any>>({});
  const lastSerialized = useRef(value);
  const activeEditor = useRef<ActiveEditor>(null);
  const views = useRef<Record<string, EditorView>>({}); // cellId -> editor (p/ inserir no cursor)

  // Assistente de escrita por célula (usa o agente configurado em Settings).
  const [sources, setSources] = useState<any[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiCellId, setAiCellId] = useState<string | null>(null);
  useEffect(() => {
    if (project) jget('/projects/' + project + '/sources').then((d) => setSources(d.sources || [])).catch(() => {});
    jget('/ai/status').then((d) => setAiEnabled(!!d.enabled)).catch(() => {});
  }, [project]);

  const inputNames = useMemo(() => collectInputs(cells), [cells]);
  const inputsForSql = useMemo(() => {
    const o: Record<string, any> = {};
    for (const n of inputNames) o[n] = { value: inputs[n] };
    return o;
  }, [inputNames, inputs]);

  const { runs, dataMap, runCell, runAll, resetRuns } = useNotebookQueries(cells, inputsForSql, params, project);

  // View Blocks (spec §4): regiões entre marcadores são read-only até Desacoplar.
  const { states: vbStates } = useMemo(() => computeVbRanges(cells), [cells]);

  // Catálogos do projeto (F4 G): habilitam drill nos blocos semânticos.
  const [semModels, setSemModels] = useState<any[]>([]);
  useEffect(() => {
    if (project) jget('/projects/' + project + '/semantic').then((d) => setSemModels((d.models || []).filter((m: any) => m.valid))).catch(() => {});
  }, [project]);

  // Drill (F4 frente G) = reedição de View Block no BUFFER do editor: a
  // exploração fica não-salva (breadcrumb visível); "Fixar" é o salvar da
  // própria página; descartar = recarregar o arquivo.
  function spliceVb(vbId: string, block: string) {
    const md = spliceViewblock(serializeCells(cells), vbId, block);
    lastSerialized.current = md;
    setCells(parseCells(md));
    onChange(md);
  }
  function semCtxOf(meta: any) {
    const m = semModels.find((x) => x.model === meta?.source?.name);
    if (!m) return null;
    const src = sources.find((s: any) => s.name === m.catalog.fact);
    if (!src) return null;
    return { catalog: m.catalog, hash: m.hash, sourceInfo: src, info: drillInfo(m.catalog, meta) };
  }
  async function drillDown(meta: any) {
    const ctx = semCtxOf(meta);
    if (!ctx?.info?.down) return;
    let values: string[] = [];
    try {
      const r = await runQuery(drillOptionsSql(ctx.catalog, meta)!, project);
      values = r.rows.map((x: any) => String(x.value));
    } catch (e: any) {
      alertDialog('Não foi possível listar os valores de ' + ctx.info.current + ': ' + String(e.message || e));
      return;
    }
    const v = await formDialog({
      title: `⤵ Drill: ${ctx.info.current} → ${ctx.info.down}`,
      message: `Escolha o valor de "${ctx.info.current}" para abrir por ${ctx.info.down}. Exploração no editor — salve a página para fixar.`,
      confirmLabel: 'Descer',
      fields: [{ name: 'valor', label: ctx.info.current, type: 'select', options: values.map((x) => ({ value: x })) }],
    });
    if (!v?.valor) return;
    try {
      const novo = applyDrillDown(ctx.catalog, meta, v.valor);
      spliceVb(meta.id, recompileSemanticVb(novo, ctx.catalog, ctx.hash, ctx.sourceInfo));
    } catch (e: any) {
      alertDialog(String(e.message || e));
    }
  }
  function drillUp(meta: any) {
    const ctx = semCtxOf(meta);
    if (!ctx?.info?.up) return;
    try {
      const novo = applyDrillUp(ctx.catalog, meta);
      spliceVb(meta.id, recompileSemanticVb(novo, ctx.catalog, ctx.hash, ctx.sourceInfo));
    } catch (e: any) {
      alertDialog(String(e.message || e));
    }
  }

  async function desacoplar(vbId: string) {
    const ok = await confirmDialog(
      'Desacoplar este View Block?\n\nO bloco perde o vínculo com o wizard (não poderá mais ser reeditado por passos) e vira texto livre editável.',
      { title: '▣ Desacoplar', confirmLabel: 'Desacoplar' }
    );
    if (!ok) return;
    const md = stripViewblockMarkers(serializeCells(cells), vbId);
    lastSerialized.current = md;
    setCells(parseCells(md));
    onChange(md);
  }

  // Reparsing externo: se o value mudou por fora (troca de arquivo), recarrega as células.
  useEffect(() => {
    if (value !== lastSerialized.current) {
      setCells(parseCells(value));
      resetRuns();
      setEdited({});
      lastSerialized.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: Cell[]) {
    setCells(next);
    const md = serializeCells(next);
    lastSerialized.current = md;
    onChange(md);
  }

  function patch(id: string, p: Partial<Cell>) {
    commit(cells.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }
  function addCell(afterIdx: number, type: CellType) {
    const c: Cell = {
      id: newId(),
      type,
      source: type === 'sql' ? 'select * from comissoes limit 10' : type === 'raw' ? '<BarChart data={query} x=x y=y/>' : 'Novo texto…',
      name: type === 'sql' ? 'query' + (cells.filter((x) => x.type === 'sql').length + 1) : undefined,
    };
    const next = [...cells];
    next.splice(afterIdx + 1, 0, c);
    commit(next);
    if (type === 'text') setEdited((e) => ({ ...e, [c.id]: true }));
  }
  function removeCell(id: string) {
    if (cells.length === 1) return;
    commit(cells.filter((c) => c.id !== id));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= cells.length) return;
    const next = [...cells];
    [next[idx], next[j]] = [next[j], next[idx]];
    commit(next);
  }
  function changeType(id: string, type: CellType) {
    const c = cells.find((x) => x.id === id)!;
    patch(id, { type, name: type === 'sql' ? c.name || 'query' : undefined });
  }

  // Insere a referência ao parâmetro na posição do cursor da célula ativa.
  // Sintaxe Evidence (canônica): SQL -> ${params.X} ; Texto -> {params.X}
  function insertParam(name: string) {
    const ae = activeEditor.current;
    if (!ae) {
      alertDialog('Clique numa célula (SQL ou Texto) para inserir o parâmetro no cursor.');
      return;
    }
    const snippet = ae.cellType === 'sql' ? '${params.' + name + '}' : '{params.' + name + '}';
    const sel = ae.view.state.selection.main;
    ae.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + snippet.length },
    });
    ae.view.focus();
  }

  // Contexto passado ao agente: tabelas (fontes), queries do notebook e params da página.
  const aiSchema = useMemo(
    () => ({
      tables: sources.map((s) => ({ name: s.name, columns: (s.columns || []).map((c: any) => ({ name: c.name, type: c.type })) })),
      queries: cells.filter((c) => c.type === 'sql' && c.name).map((c) => c.name),
      params: paramNames,
    }),
    [sources, cells, paramNames]
  );

  const PLACEHOLDERS = ['Novo texto…', 'select * from comissoes limit 10', '<BarChart data={query} x=x y=y/>'];
  const isBlankCell = (c: Cell) => !c.source.trim() || PLACEHOLDERS.includes(c.source.trim());

  function toggleAi(c: Cell) {
    if (aiCellId === c.id) {
      setAiCellId(null);
      return;
    }
    setAiCellId(c.id);
    if (c.type === 'text') setEdited((e) => ({ ...e, [c.id]: true })); // monta o editor p/ inserir no cursor
  }

  // Conteúdo gerado pelo agente: insere no cursor, ou substitui a célula "em branco".
  function insertGenerated(c: Cell, content: string) {
    const v = views.current[c.id];
    if (isBlankCell(c) || !v) {
      patch(c.id, { source: content });
    } else {
      const sel = v.state.selection.main;
      v.dispatch({ changes: { from: sel.from, to: sel.to, insert: content }, selection: { anchor: sel.from + content.length } });
      v.focus();
    }
    if (c.type === 'text') setEdited((e) => ({ ...e, [c.id]: true }));
    setAiCellId(null);
  }

  return (
    <div className="nb">
      <div className="nb-toolbar">
        <button onClick={runAll}>▶▶ Rodar tudo</button>
        {paramNames.length > 0 && (
          <div className="nb-params">
            <span className="muted small">Inserir parâmetro:</span>
            {paramNames.map((n) => (
              <button key={n} className="param-chip" onClick={() => insertParam(n)} title={`Inserir referência a ${n} no cursor`}>
                {n}
              </button>
            ))}
          </div>
        )}
        {inputNames.length > 0 && (
          <div className="nb-params">
            <span className="muted small">Filtros:</span>
            {inputNames.map((n) => (
              <label key={n} className="nb-param">
                {n}=
                <input
                  value={inputs[n] ?? ''}
                  placeholder="valor"
                  onChange={(e) => setInputs((p) => ({ ...p, [n]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {cells.map((c, idx) => {
        const st = vbStates[idx];
        const inVb = !!st?.vb;
        const markerOnly = inVb && isMarkerOnlyCell(c);
        return (
          <div key={c.id} className={'nb-cell nb-' + c.type + (inVb ? ' in-vb' : '') + (idx === st?.vb?.end ? ' vb-last' : '')}>
            {st?.isFirst && (
              <div className="nb-vb-head">
                <span className="nb-vb-badge">▣ View Block</span>
                {st.vb!.meta?.style && <span className="nb-vb-style">{String(st.vb!.meta.style)}</span>}
                {(() => {
                  const meta = st.vb!.meta;
                  if (meta?.source?.kind !== 'semantic') return null;
                  const ctx = semCtxOf(meta);
                  if (!ctx?.info) return null;
                  return (
                    <span className="nb-vb-drill" title={`hierarquia ${ctx.info.hierarchy}: ${ctx.info.levels.join(' ▸ ')}`}>
                      {ctx.info.crumbs.map((c: any) => (
                        <span key={c.dim} className="nb-vb-crumb">
                          {String(c.value)} ▸
                        </span>
                      ))}
                      <span className="nb-vb-crumb atual">{ctx.info.current}</span>
                      <button disabled={!ctx.info.down} onClick={() => drillDown(meta)} title={ctx.info.down ? `⤵ Descer para ${ctx.info.down} (escolhe um valor de ${ctx.info.current} e filtra)` : 'não há nível mais fino'}>
                        ⤵
                      </button>
                      <button disabled={!ctx.info.up} onClick={() => drillUp(meta)} title={ctx.info.up ? `⤴ Subir para ${ctx.info.up} (solta o filtro)` : 'já está no nível mais alto'}>
                        ⤴
                      </button>
                    </span>
                  );
                })()}
                <span className="muted small">gerado pelo wizard — reedite por passos ou desacople</span>
                <div className="nb-spacer" />
                <button disabled={!onEditViewblock} onClick={() => onEditViewblock?.(st.vb!.id, 4)} title="Reabrir Apresentação (troca o estilo sem tocar no SQL)">
                  ▣
                </button>
                <button disabled={!onEditViewblock} onClick={() => onEditViewblock?.(st.vb!.id, 2)} title="Reabrir Seleção (dims, medidas, filtros)">
                  Σ
                </button>
                <button disabled={!onEditViewblock} onClick={() => onEditViewblock?.(st.vb!.id, 3)} title="Reabrir Argumentos (parâmetros declarados)">
                  ⚙
                </button>
                <button onClick={() => desacoplar(st.vb!.id)} title="Remove os marcadores; o conteúdo vira texto livre editável">
                  Desacoplar
                </button>
              </div>
            )}
            {!markerOnly && (
              <>
                <div className="nb-gutter">
                  <select
                    value={c.type}
                    onChange={(e) => changeType(c.id, e.target.value as CellType)}
                    title={inVb ? 'Célula de View Block (desacople para editar)' : 'Tipo da célula'}
                    disabled={inVb}
                  >
                    <option value="text">Texto</option>
                    <option value="sql">SQL</option>
                    <option value="raw">Raw</option>
                  </select>
                  {c.type === 'sql' && (
                    <button className="nb-run" onClick={() => runCell(c)} title="Rodar (Ctrl+Enter)">
                      ▶
                    </button>
                  )}
                  <button
                    className={'nb-ai-btn' + (aiCellId === c.id ? ' on' : '')}
                    onClick={() => toggleAi(c)}
                    disabled={!aiEnabled || inVb}
                    title={inVb ? 'Célula de View Block (read-only)' : aiEnabled ? 'Assistente de escrita (agente)' : 'Configure o agente em Settings › Agente'}
                  >
                    ✨
                  </button>
                  <div className="nb-spacer" />
                  <button onClick={() => move(idx, -1)} title="Mover para cima" disabled={idx === 0 || inVb}>
                    ↑
                  </button>
                  <button onClick={() => move(idx, 1)} title="Mover para baixo" disabled={idx === cells.length - 1 || inVb}>
                    ↓
                  </button>
                  <button onClick={() => removeCell(c.id)} title="Excluir" disabled={cells.length === 1 || inVb}>
                    ✕
                  </button>
                </div>

                <div className="nb-body">
                  {c.type === 'sql' && (
                    <input
                      className="nb-qname"
                      value={c.name || ''}
                      onChange={(e) => patch(c.id, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') })}
                      placeholder="nome_da_query"
                      title="Nome da query (usado nos componentes via data={nome})"
                      disabled={inVb}
                    />
                  )}

                  {c.type === 'text' && (!edited[c.id] || inVb) ? (
                    <div
                      className="nb-md"
                      onDoubleClick={inVb ? undefined : () => setEdited((e) => ({ ...e, [c.id]: true }))}
                      title={inVb ? 'View Block (read-only até desacoplar)' : 'Duplo-clique para editar'}
                      dangerouslySetInnerHTML={{ __html: mdIt.render(renderInline(c.source || '_(vazio)_', dataMap, params)) }}
                    />
                  ) : (
                    <CellEditor
                      cell={c}
                      readOnly={inVb}
                      onChange={(v) => patch(c.id, { source: v })}
                      onRun={() => (c.type === 'sql' ? runCell(c) : setEdited((e) => ({ ...e, [c.id]: false })))}
                      onBlurText={() => setEdited((e) => ({ ...e, [c.id]: false }))}
                      onFocusEditor={(view) => {
                        activeEditor.current = { view, cellType: c.type };
                        views.current[c.id] = view;
                      }}
                      onView={(view) => (views.current[c.id] = view)}
                    />
                  )}

                  {c.type === 'sql' && runs[c.id] && (
                    <div className="nb-out">
                      {runs[c.id].loading ? (
                        <div className="muted small">Rodando…</div>
                      ) : (
                        <ResultsGrid columns={runs[c.id].columns} rows={runs[c.id].rows} error={runs[c.id].error} />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {aiCellId === c.id && !inVb && (
              <CellAssistant cell={c} schema={aiSchema} onInsert={(content) => insertGenerated(c, content)} onClose={() => setAiCellId(null)} />
            )}

            {!inVb || idx === st?.vb?.end ? (
              <div className="nb-add">
                <button onClick={() => addCell(idx, 'text')}>+ Texto</button>
                <button onClick={() => addCell(idx, 'sql')}>+ SQL</button>
                <button onClick={() => addCell(idx, 'raw')}>+ Raw</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
