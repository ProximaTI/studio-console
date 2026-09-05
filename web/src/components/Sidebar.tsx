import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { jget, jpost } from '../api';
import { promptDialog } from './dialogs';

// Sidebar de DOIS níveis (spec §3): global = lista de projetos + settings;
// com projeto aberto = espaços do projeto (Páginas / Dados / Novo relatório).
export default function Sidebar({ org }: { org?: string }) {
  const [projects, setProjects] = useState<string[]>([]);
  const nav = useNavigate();
  const location = useLocation();
  const m = location.pathname.match(/^\/projects\/([^/]+)/);
  const project = m ? decodeURIComponent(m[1]) : null;

  const load = () => jget('/projects').then((d) => setProjects(d.projects || []));
  useEffect(() => {
    load();
  }, [location.pathname]);

  async function newProject() {
    const name = await promptDialog('Nome do novo projeto', { title: 'Novo projeto', placeholder: 'meu_projeto' });
    if (!name) return;
    const r = await jpost('/projects', { name });
    await load();
    nav('/projects/' + r.name);
  }

  const navCls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  const initial = (org || 'S').trim().charAt(0).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-logo">⬡</div>
        <div className="sb-brand-name">Studio</div>
      </div>
      <div className="sb-workspace">workspace · {(org || 'local').toLowerCase()}</div>

      {project ? (
        <>
          <nav className="menu">
            <NavLink to="/" end className={navCls}>
              <span className="ico">←</span>Projetos
            </NavLink>
          </nav>
          <div className="sb-group mt">{project === 'scratch' ? 'Rascunho' : project}</div>
          <nav className="menu">
            {/* F6: Relatórios (specs) é item de 1º nível; "Novo relatório" virou
                botão dentro dele (o wizard bloco-a-bloco fica em Páginas). */}
            <NavLink to={'/projects/' + project + '/reports'} className={navCls}>
              <span className="ico">▦</span>Relatórios
            </NavLink>
            <NavLink to={'/projects/' + project} end className={navCls}>
              <span className="ico">▤</span>Páginas
            </NavLink>
            <NavLink to={'/projects/' + project + '/data'} className={navCls}>
              <span className="ico">⛁</span>Dados
            </NavLink>
          </nav>
        </>
      ) : (
        <>
          <div className="sb-group">Projetos</div>
          <div className="projects">
            {projects.map((p) => (
              <NavLink key={p} to={'/projects/' + p} className={navCls}>
                <span className="dot" />
                {p === 'scratch' ? 'Rascunho ✏' : p}
              </NavLink>
            ))}
            <button className="sb-newproj" onClick={newProject}>
              ＋ Novo projeto
            </button>
          </div>
        </>
      )}

      <div className="sb-foot">
        <div className="sb-divider" />
        <nav className="menu">
          <a href="https://docs.evidence.dev" target="_blank" rel="noreferrer">
            <span className="ico">↗</span>Docs
          </a>
          <NavLink to="/connections" className={navCls} title="Registro global de conexões (arquiteto)">
            <span className="ico">⇌</span>Conexões
          </NavLink>
          <NavLink to="/settings" className={navCls}>
            <span className="ico">⚙</span>Settings
          </NavLink>
        </nav>
        <div className="sb-user">
          <div className="sb-avatar">{initial}</div>
          <div className="sb-user-meta">
            {org || 'Studio'}
            <br />
            <span>console local</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
