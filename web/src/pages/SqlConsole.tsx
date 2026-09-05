import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SqlEditor from '../components/SqlEditor';
import ResultsGrid from '../components/ResultsGrid';
import QueryBuilder from '../components/builder/QueryBuilder';
import { jget, jput, runQuery } from '../api';
import { alertDialog, confirmDialog, promptDialog } from '../components/dialogs';

type Mode = 'editor' | 'builder';

const NUMRE = /INT|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC/i;
const KEYRE = /(_id|_code|_key)$|^id$|Id$/;
const isMeasure = (c: any) => NUMRE.test(c.type) && !KEYRE.test(c.name);

// SQL Console DO PROJETO (espaço Dados): consulta as fontes do projeto e salva
// queries direto em queries/ dele — sem escolher projeto.
export default function SqlConsole({ project }: { project: string }) {
  const navigate = useNavigate();
  const [sources, setSources] = useState<any[]>([]);
  const [sqlText, setSqlText] = useState('select 1 as ok');
  const [res, setRes] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem('studio.sqlmode') as Mode) || 'editor');
  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem('studio.sqlmode', m);
  };

  useEffect(() => {
    jget('/projects/' + project + '/sources').then((d) => {
      const src = d.sources || [];
      setSources(src);
      if (src.length) setSqlText((prev) => (prev === 'select 1 as ok' ? `select * from ${src[0].name} limit 20` : prev));
    });
  }, [project]);

  async function run() {
    setRunning(true);
    const t0 = performance.now();
    const r = await runQuery(sqlText, project);
    setMs(Math.round(performance.now() - t0));
    setRes(r);
    setRunning(false);
  }

  async function toggleTable(name: string) {
    const next = !open[name];
    setOpen((p) => ({ ...p, [name]: next }));
    if (next && counts[name] === undefined) {
      const r = await runQuery(`select count(*) as n from "${name}"`, project);
      const n = r.rows && r.rows[0] ? Number(r.rows[0].n) : 0;
      setCounts((p) => ({ ...p, [name]: n }));
    }
  }

  const fmtCount = (n?: number) => (n === undefined ? '' : n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n));

  // Salva a query em queries/ DESTE projeto (reuso via frontmatter e aba 🧮 queries).
  async function saveToProject() {
    if (!sqlText.trim()) return;
    const n = await promptDialog('Nome do arquivo .sql (vai para queries/ do projeto):', {
      title: 'Salvar query em ' + project,
      defaultValue: 'minha_query.sql',
    });
    if (!n) return;
    const name = (n.endsWith('.sql') ? n : n + '.sql').replace(/[^a-zA-Z0-9_.-]/g, '_');
    setSaving(true);
    const r = await jput('/projects/' + project + '/query-file', { path: name, content: sqlText.replace(/\s+$/, '') + '\n' });
    setSaving(false);
    if (r.error) {
      alertDialog('Erro ao salvar: ' + r.error);
      return;
    }
    const abrir = await confirmDialog(
      `Salva em ${project}/queries/${name}.\n\n` +
        `Para usar numa página, referencie no frontmatter:\n  queries:\n    - minha_consulta: ${name}\n\n` +
        'Abrir as Páginas agora?',
      { confirmLabel: 'Abrir Páginas' }
    );
    if (abrir) navigate('/projects/' + project);
  }

  const shown = filter.trim()
    ? sources.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : sources;

  return (
    <div className="sqlconsole">
      <div className="win-frame">
        <div className="win-bar sql-topbar">
          <span className="win-crumb">
            <span className="data">›_</span> SQL Console · {project}
          </span>
          <div className="mode-switch">
            <button className={mode === 'editor' ? 'active' : ''} onClick={() => setMode('editor')}>
              Editor
            </button>
            <button className={mode === 'builder' ? 'active' : ''} onClick={() => setMode('builder')}>
              ✨ Builder visual
            </button>
          </div>
          <span className="sql-meta">DuckDB · {sources.length} tabelas</span>
        </div>

        {mode === 'builder' ? (
          <div className="sql-builder-wrap">
            <QueryBuilder
              project={project}
              sources={sources}
              onSendSql={(sql) => {
                setSqlText(sql);
                setMode('editor');
              }}
            />
          </div>
        ) : (
          <div className="sql-body">
            <aside className="schema-explorer">
              <div className="schema-search">
                <span className="ico">⌕</span>
                <input placeholder="filtrar tabelas…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <div className="eyebrow" style={{ padding: '2px 6px 8px' }}>
                Sources
              </div>
              {shown.map((s) => (
                <div key={s.name} className="schema-tbl">
                  <div
                    className={'schema-tbl-head' + (open[s.name] ? ' open' : '')}
                    onClick={() => toggleTable(s.name)}
                    onDoubleClick={() => setSqlText('select * from ' + s.name + ' limit 100')}
                    title="Clique para expandir · duplo-clique insere SELECT"
                  >
                    <span className="schema-caret">{open[s.name] ? '▾' : '▸'}</span>
                    <span className={'schema-tbl-name' + (open[s.name] ? '' : ' dim')}>{s.name}</span>
                    <span className="schema-count">{fmtCount(counts[s.name])}</span>
                  </div>
                  {open[s.name] && (
                    <div className="schema-cols">
                      {s.columns.map((c: any) => (
                        <div
                          key={c.name}
                          className="schema-col"
                          onClick={() => setSqlText('select * from ' + s.name + ' limit 100')}
                        >
                          <span className={'n' + (isMeasure(c) ? ' measure' : '')}>{c.name}</span>
                          <span className="t">{String(c.type).toLowerCase()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </aside>

            <div className="sql-main">
              <div className="sql-editor-wrap">
                <SqlEditor value={sqlText} onChange={setSqlText} onRun={run} height="240px" />
              </div>
              <div className="sql-runbar">
                <button className="run" onClick={run} disabled={running}>
                  {running ? 'Rodando…' : 'Run ▶'} <span className="kbd">⌘⏎</span>
                </button>
                <button onClick={saveToProject} disabled={saving || !sqlText.trim()} title="Salvar em queries/ do projeto para reuso">
                  💾 Salvar no projeto
                </button>
                {res && !res.error && res.rows && (
                  <span className="sql-status">
                    <span className="dot" />
                    {res.rows.length} linha(s){ms != null ? ` · ${ms} ms` : ''}
                  </span>
                )}
              </div>
              <div className="sql-results">
                <ResultsGrid columns={res?.columns} rows={res?.rows} error={res?.error} measures />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
