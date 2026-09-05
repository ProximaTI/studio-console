import { useState } from 'react';
import { Blocks, usePreview } from '../markdown';
import { formatNumber } from '../../format';

// Componentes de layout do dialeto Evidence: Note, LinkButton, Grid/Card, Tabs/Tab.
// Todos recebem __children (blocos parseados do conteúdo interno) e re-renderizam
// via <Blocks/>, então markdown/SQL/componentes aninhados funcionam dentro deles.

export function Note(props: any) {
  return (
    <div className="note">
      <Blocks blocks={props.__children || []} />
    </div>
  );
}

// <Details title="..."> conteúdo recolhível </Details> (Evidence)
export function Details(props: any) {
  return (
    <details className="ev-details">
      <summary>{props.title || 'Detalhes'}</summary>
      <div className="ev-details-body">
        <Blocks blocks={props.__children || []} />
      </div>
    </details>
  );
}

// <div> minúsculo: agrupador neutro (célula de <Grid cols=N>, etc.)
export function Div(props: any) {
  return (
    <div className="ev-div">
      <Blocks blocks={props.__children || []} />
    </div>
  );
}

export function LinkButton(props: any) {
  const { onLink } = usePreview();
  const text = innerText(props);
  const url = props.url || '#';
  const external = /^https?:\/\//.test(url);
  return (
    <a
      className="linkbtn"
      href={url}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      onClick={(e) => {
        if (!external && onLink) {
          e.preventDefault();
          onLink(url);
        }
      }}
    >
      {text || url}
    </a>
  );
}

export function Grid(props: any) {
  const cols = Number(props.cols) || 2;
  const gap = (Number(props.gap) || 4) * 4;
  return (
    <div className="ev-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
      <Blocks blocks={props.__children || []} />
    </div>
  );
}

export function Card(props: any) {
  const { onLink } = usePreview();
  const link = props.link;
  return (
    <div
      className={'ev-card' + (link ? ' clickable' : '')}
      onClick={() => {
        if (link && onLink) onLink(link);
      }}
    >
      <Blocks blocks={props.__children || []} />
    </div>
  );
}

export function CardTitle(props: any) {
  return <div className="ev-card-title">{innerText(props)}</div>;
}

export function CardBody(props: any) {
  return (
    <div className="ev-card-body">
      <Blocks blocks={props.__children || []} />
    </div>
  );
}

export function Tabs(props: any) {
  const tabs = (props.__children || []).filter((b: any) => b.type === 'component' && b.name === 'Tab');
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return <Blocks blocks={props.__children || []} />;
  return (
    <div className="ev-tabs">
      <div className="ev-tabbar">
        {tabs.map((t: any, i: number) => (
          <button key={i} className={i === active ? 'active' : ''} onClick={() => setActive(i)}>
            {t.attrs.label || `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div className="ev-tabpanel">
        <Blocks blocks={tabs[active]?.children || []} />
      </div>
    </div>
  );
}

// Tab só existe dentro de <Tabs>; se aparecer solto, renderiza o conteúdo direto.
export function Tab(props: any) {
  return <Blocks blocks={props.__children || []} />;
}

// <Value data={q} column=x fmt=.../> — valor escalar embutido no texto (Evidence).
export function Value(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <span className="error">{errors[props.data]}</span>;
  const rows = dataMap[props.data] || [];
  const col = props.column || (rows[0] ? Object.keys(rows[0])[0] : '');
  const v = rows[0]?.[col];
  return <span className="ev-value">{typeof v === 'number' ? formatNumber(v, props.fmt, settings) : String(v ?? '—')}</span>;
}

// Texto puro do conteúdo interno (para componentes de uma linha tipo CardTitle).
function innerText(props: any): string {
  const blocks = props.__children || [];
  return blocks
    .filter((b: any) => b.type === 'md')
    .map((b: any) => b.text.trim())
    .join(' ')
    .trim();
}
