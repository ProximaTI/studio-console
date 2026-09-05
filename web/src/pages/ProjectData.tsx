import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import SourcesPanel from './Connectors';
import SqlConsole from './SqlConsole';
import Models from './Models';
import SemanticPanel from './SemanticPanel';

type Tab = 'fontes' | 'sql' | 'models' | 'semantica';

// Espaço "Dados" do projeto: fontes + SQL Console + models, tudo escopado.
// (Absorve os antigos itens globais Connectors / SQL Console / Models.)
export default function ProjectData() {
  const { project = '' } = useParams();
  // ?aba= permite deep-link direto numa aba (ex.: /data?aba=semantica)
  const [search] = useSearchParams();
  const abaUrl = search.get('aba') as Tab | null;
  const [tab, setTabState] = useState<Tab>(() =>
    abaUrl && ['fontes', 'sql', 'models', 'semantica'].includes(abaUrl)
      ? abaUrl
      : (localStorage.getItem('studio.datatab') as Tab) || 'fontes'
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    localStorage.setItem('studio.datatab', t);
  };

  return (
    <div className="pdata">
      <div className="pdata-bar">
        <span className="pdata-crumb">
          <span className="data">⛁</span> Dados · <b>{project}</b>
        </span>
        <div className="mode-switch">
          <button className={tab === 'fontes' ? 'active' : ''} onClick={() => setTab('fontes')}>
            Fontes
          </button>
          <button className={tab === 'sql' ? 'active' : ''} onClick={() => setTab('sql')}>
            SQL Console
          </button>
          <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>
            Models
          </button>
          <button className={tab === 'semantica' ? 'active' : ''} onClick={() => setTab('semantica')}>
            Semântica
          </button>
        </div>
      </div>
      {tab === 'fontes' && <SourcesPanel project={project} />}
      {tab === 'sql' && <SqlConsole project={project} />}
      {tab === 'models' && <Models project={project} />}
      {tab === 'semantica' && <SemanticPanel project={project} />}
    </div>
  );
}
