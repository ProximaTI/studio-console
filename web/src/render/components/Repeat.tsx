import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { usePreview } from '../markdown';
import { buildChartOption } from '../../../../shared/chartOption.js';

// <Repeat data={q} by="regiao" childStyle=tabular x=servico y=faturamento maxGroups=50/>
// Container do estilo Nested (F3 §5): recebe a query ÚNICA particionada
// (row_number por grupo já aplicado no SQL) e injeta cada partição na
// instância do bloco-filho. Partição no CLIENTE — nos 3 ambientes.
export default function Repeat(props: any) {
  const { dataMap, errors } = usePreview();
  const rows = dataMap[props.data] || [];
  const err = errors[props.data];
  if (err) return <div className="error">{err}</div>;

  const by = String(props.by || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const maxGroups = Number(props.maxGroups) || 50;
  const childStyle = props.childStyle || 'tabular';

  // particiona preservando a ordem do SQL (order by pais, _rn)
  const groups: { key: string; rows: any[] }[] = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    const key = by.map((c) => String(r[c])).join(' · ');
    if (!idx.has(key)) {
      idx.set(key, groups.length);
      groups.push({ key, rows: [] });
    }
    groups[idx.get(key)!].rows.push(r);
  }
  const shown = groups.slice(0, maxGroups);
  const hiddenCols = new Set([...by, '_rn']);

  return (
    <div className="repeat">
      {groups.length > maxGroups && (
        <div className="error">
          ⚠ {groups.length} grupos — mostrando os primeiros {maxGroups} (maxGroups). Filtre ou aumente o limite.
        </div>
      )}
      {shown.map((g) => (
        <div key={g.key} className="repeat-group">
          <div className="repeat-title">{g.key}</div>
          {childStyle === 'tabular' ? (
            <table className="grid">
              <thead>
                <tr>
                  {Object.keys(g.rows[0] || {})
                    .filter((c) => !hiddenCols.has(c))
                    .map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i}>
                    {Object.keys(r)
                      .filter((c) => !hiddenCols.has(c))
                      .map((c) => (
                        <td key={c}>{String(r[c] ?? '')}</td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <GroupChart rows={g.rows} x={props.x} y={props.y} line={childStyle === 'graph.line'} />
          )}
        </div>
      ))}
    </div>
  );
}

function GroupChart({ rows, x, y, line }: { rows: any[]; x: string; y: string; line: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const { settings } = usePreview();
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current);
    chart.setOption(
      buildChartOption({
        kind: line ? 'line' : 'bar',
        rows,
        attrs: { x, y },
        palette: settings?.theme?.chartPalette,
        dark: settings?.theme?.mode === 'dark',
      }) as any
    );
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [rows, x, y, line, settings]);
  return <div ref={el} style={{ height: 220, width: '100%' }} />;
}
