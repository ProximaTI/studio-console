import { useMemo, useState } from 'react';
import { usePreview } from '../markdown';
import { formatNumber } from '../../format';

type ColDef = {
  id: string;
  title?: string;
  fmt?: string;
  align?: string;
  contentType?: string; // delta | colorscale | link
  wrap?: string;
  linkLabel?: string;
  openInNewTab?: string;
};

export default function DataTable(props: any) {
  const { dataMap, errors, settings, onLink } = usePreview();
  const [q, setQ] = useState('');
  const allRows: any[] = dataMap[props.data] || [];
  const linkCol = props.link; // navegação no clique da 1ª coluna (dialeto console)

  let rows = allRows;
  // filter="coluna = 'valor'" (subconjunto simples do Evidence)
  if (props.filter) {
    const m = String(props.filter).match(/^\s*(\w+)\s*=\s*['"](.*)['"]\s*$/);
    if (m) rows = rows.filter((r) => String(r[m[1]]) === m[2]);
  }
  // search=true: busca client-side em todas as colunas
  const searchable = String(props.search) === 'true';
  if (searchable && q.trim()) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(needle)));
  }

  // <Column id=... title=... fmt=... align=... contentType=... /> filhos (Evidence)
  const colDefs: ColDef[] = (props.__children || [])
    .filter((b: any) => b.type === 'component' && b.name === 'Column')
    .map((b: any) => b.attrs as ColDef);
  const cols: ColDef[] =
    colDefs.length > 0
      ? colDefs.filter((c) => c.id !== linkCol)
      : rows[0]
        ? Object.keys(rows[0])
            .filter((c) => c !== linkCol)
            .map((c) => ({ id: c }))
        : [];
  const numCols = new Set(cols.filter((c) => typeof rows[0]?.[c.id] === 'number').map((c) => c.id));

  // Escala de cor por coluna (contentType=colorscale): intensidade ∝ valor/max
  const scaleMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cols) {
      if (c.contentType === 'colorscale') m[c.id] = Math.max(1e-9, ...rows.map((r) => Number(r[c.id]) || 0));
    }
    return m;
  }, [cols, rows]);

  const limit = props.rows ? Number(props.rows) : 50;

  function go(href: string, e: any) {
    if (onLink) {
      e.preventDefault();
      onLink(href);
    }
  }

  function alignClass(c: ColDef) {
    if (c.align === 'right' || (!c.align && numCols.has(c.id))) return 'num';
    if (c.align === 'center') return 'ctr';
    return '';
  }

  function downloadCsv() {
    const header = cols.map((c) => c.title || c.id);
    const lines = [header, ...rows.map((r) => cols.map((c) => r[c.id]))].map((cells) =>
      cells.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')
    );
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (props.data || 'dados') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (allRows.length === 0 && errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  if (allRows.length === 0) return <div className="muted">Sem dados.</div>;

  return (
    <div>
      {(searchable || String(props.downloadable) === 'true') && (
        <div className="dt-toolbar">
          {searchable && <input placeholder="buscar…" value={q} onChange={(e) => setQ(e.target.value)} />}
          {String(props.downloadable) === 'true' && (
            <button onClick={downloadCsv} title="Baixar CSV ({rows} linhas filtradas)">
              ⬇ CSV
            </button>
          )}
          <span className="muted small">{rows.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>
      )}
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.id} className={alignClass(c)}>
                  {c.title || c.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r: any, i: number) => {
              const href = linkCol ? r[linkCol] : null;
              return (
                <tr key={i}>
                  {cols.map((c, ci) => {
                    const raw = r[c.id];
                    let content: any =
                      typeof raw === 'number' || c.fmt ? formatNumber(raw, c.fmt, settings) : raw == null ? '' : String(raw);
                    let cls = alignClass(c);
                    let style: any;
                    if (c.wrap === 'true') cls += ' wrap';
                    if (c.contentType === 'delta' && typeof raw === 'number') {
                      cls += raw >= 0 ? ' delta-up' : ' delta-down';
                      if (raw > 0) content = '▲ ' + content;
                      else if (raw < 0) content = '▼ ' + content;
                    }
                    if (c.contentType === 'colorscale' && typeof raw === 'number') {
                      const t = Math.max(0, Math.min(1, raw / scaleMax[c.id]));
                      style = { background: `rgba(35, 106, 164, ${0.08 + 0.42 * t})` };
                    }
                    // contentType=link: o VALOR da célula é a URL (Evidence)
                    if (c.contentType === 'link' && raw) {
                      const label = c.linkLabel && r[c.linkLabel] !== undefined ? r[c.linkLabel] : c.linkLabel || String(raw);
                      content = (
                        <a href={String(raw)} target={c.openInNewTab === 'true' ? '_blank' : undefined} rel="noreferrer">
                          {label}
                        </a>
                      );
                    }
                    const linkable = href && ci === 0 && c.contentType !== 'link';
                    return (
                      <td key={c.id} className={cls} style={style}>
                        {linkable ? (
                          <a href={href} onClick={(e) => go(href, e)}>
                            {content}
                          </a>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
