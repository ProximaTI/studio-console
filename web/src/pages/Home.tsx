import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jget, jpost, jdel } from '../api';
import { confirmDialog, promptDialog } from '../components/dialogs';

type Meta = { pages: number };

// Nível GLOBAL da console: apenas a lista de projetos (abrir/criar/promover/
// descartar) — todo o resto vive DENTRO do projeto (spec §3).
export default function Home() {
  const nav = useNavigate();
  const [org, setOrg] = useState('');
  const [projects, setProjects] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, Meta>>({});

  const load = useCallback(async () => {
    const d = await jget('/projects');
    const projs: string[] = d.projects || [];
    setProjects(projs);
    const entries = await Promise.all(
      projs.map(async (p) => {
        const f = await jget('/projects/' + p + '/files').catch(() => ({}));
        return [p, { pages: (f.files || []).length }] as const;
      })
    );
    setMeta(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    jget('/settings').then((s) => setOrg(s?.organization?.name || ''));
    load();
  }, [load]);

  async function newProject() {
    const name = await promptDialog('Nome do novo projeto', { title: 'Novo projeto', placeholder: 'meu_projeto' });
    if (!name) return;
    const r = await jpost('/projects', { name });
    if (r.error) return;
    nav('/projects/' + r.name);
  }

  async function promote(from: string) {
    const name = await promptDialog('Nome definitivo do projeto (o rascunho vira um projeto nomeado):', {
      title: 'Promover rascunho',
      placeholder: 'meu_projeto',
    });
    if (!name) return;
    const r = await jpost('/projects/' + from + '/promote', { name });
    if (r.error) return;
    nav('/projects/' + r.name);
  }

  async function discard(p: string) {
    if (!(await confirmDialog(`Descartar o rascunho? Páginas, fontes e queries dele serão excluídas.`, { confirmLabel: 'Descartar', danger: true })))
      return;
    await jdel('/projects/' + p);
    load();
  }

  const isScratch = (p: string) => p === 'scratch';

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <div className="eyebrow">workspace · {(org || 'local').toLowerCase()}</div>
          <h1>Projetos</h1>
          <p className="muted">O projeto é a unidade de trabalho: páginas, fontes de dados, queries e publicação vivem dentro dele.</p>
        </div>
        <button className="run" onClick={newProject}>
          ＋ Novo projeto
        </button>
      </div>

      <div className="pj-grid">
        {projects.map((p) => (
          <div key={p} className={'pj-card' + (isScratch(p) ? ' scratch' : '')} onClick={() => nav('/projects/' + p)}>
            <div className="pj-head">
              <span className="pj-name">{isScratch(p) ? 'Rascunho' : p}</span>
              {isScratch(p) && <span className="pj-badge">scratch</span>}
            </div>
            <div className="pj-meta">{meta[p] ? `${meta[p].pages} página(s)` : '…'}</div>
            <div className="pj-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => nav('/projects/' + p)}>Abrir</button>
              <button onClick={() => nav('/projects/' + p + '/data')}>Dados</button>
              {isScratch(p) && (
                <>
                  <button onClick={() => promote(p)} title="Vira um projeto nomeado, preservando fontes e páginas">
                    Promover…
                  </button>
                  <button className="danger" onClick={() => discard(p)}>
                    Descartar
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="muted small" style={{ marginTop: 18 }}>
        Explore sem compromisso no <b>Rascunho</b> — depois é só promover para um projeto nomeado.
      </p>
    </div>
  );
}
