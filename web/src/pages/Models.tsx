import { useEffect, useState } from 'react';
import SqlEditor from '../components/SqlEditor';
import ResultsGrid from '../components/ResultsGrid';
import { jget, jpost, jput, jdel, runQuery } from '../api';
import { alertDialog, confirmDialog } from '../components/dialogs';

// Painel "Models" do espaço Dados: queries SQL reutilizáveis DO PROJETO.
export default function Models({ project }: { project: string }) {
  const [models, setModels] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [res, setRes] = useState<any>(null);
  const base = '/projects/' + project + '/models';
  const load = () => jget(base).then((d) => setModels(d.models || []));
  useEffect(() => {
    setSel(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  function nw() {
    setSel({ name: '', description: '', sql: 'select 1 as ok' });
    setRes(null);
  }
  async function save() {
    if (!sel.name) return alertDialog('Dê um nome ao model');
    if (sel.id) await jput(base + '/' + sel.id, sel);
    else {
      const r = await jpost(base, sel);
      setSel(r.model);
    }
    load();
  }
  async function run() {
    const r = await runQuery(sel.sql, project);
    setRes(r);
    if (sel.id) {
      const upd = { ...sel, lastRun: new Date().toISOString() };
      setSel(upd);
      jput(base + '/' + sel.id, upd).then(load);
    }
  }
  async function del() {
    if (sel.id && (await confirmDialog('Excluir model?', { confirmLabel: 'Excluir', danger: true }))) {
      await jdel(base + '/' + sel.id);
      setSel(null);
      load();
    }
  }

  return (
    <div className="page">
      <p className="muted">Queries SQL reutilizáveis do projeto.</p>
      <div className="models-layout">
        <div className="models-list">
          <button className="newproj" onClick={nw}>
            + New Model
          </button>
          {models.map((m) => (
            <div
              key={m.id}
              className={'model-item' + (sel?.id === m.id ? ' active' : '')}
              onClick={() => {
                setSel(m);
                setRes(null);
              }}
            >
              <b>{m.name}</b>
              <div className="muted small">{m.description}</div>
              <div className="muted small">Last run: {m.lastRun ? new Date(m.lastRun).toLocaleString() : '—'}</div>
            </div>
          ))}
        </div>
        <div className="model-editor">
          {!sel && <div className="muted">Selecione um model ou crie um novo.</div>}
          {sel && (
            <>
              <input placeholder="Nome" value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} />
              <input
                placeholder="Descrição"
                value={sel.description}
                onChange={(e) => setSel({ ...sel, description: e.target.value })}
              />
              <div className="editor-box">
                <SqlEditor value={sel.sql} onChange={(v) => setSel({ ...sel, sql: v })} onRun={run} height="200px" />
              </div>
              <div className="row">
                <button className="run" onClick={run}>
                  Run ▶
                </button>
                <button onClick={save}>Salvar</button>
                {sel.id && <button onClick={del}>Excluir</button>}
              </div>
              <ResultsGrid columns={res?.columns} rows={res?.rows} error={res?.error} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
