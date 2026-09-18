import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { usePreview } from '../markdown';
import { buildChartOption } from '../../../../shared/chartOption.js';
import { chartPaletteOf } from '../../../../shared/designTokens.js';
import { partitionBy, sharedDomain, isPanelChart, PANEL_HEIGHT } from '../../../../shared/smallMultiples.js';

// <Repeat data={q} by="regiao" childStyle=tabular x=servico y=faturamento maxGroups=50/>
// Container do estilo Nested (F3 §5): recebe a query ÚNICA particionada
// (row_number por grupo já aplicado no SQL) e injeta cada partição no bloco-filho.
//
// Filho GRÁFICO vira PEQUENO MÚLTIPLO: grade + escala compartilhada entre todos
// os painéis (shared/smallMultiples.js). Sem o domínio comum seriam só gráficos
// repetidos, e comparar painéis induziria ao erro. Filho TABELA segue empilhado
// em largura cheia, onde a coluna precisa de espaço.
export default function Repeat(props: any) {
  const { dataMap, errors, settings } = usePreview();
  const rows = dataMap[props.data] || [];
  const err = errors[props.data];
  if (err) return <div className="error">{err}</div>;

  const childStyle = props.childStyle || 'tabular';
  const painel = isPanelChart(childStyle);
  const { groups, total } = partitionBy(rows, props.by, props.maxGroups);
  const by = String(props.by || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const hiddenCols = new Set([...by, '_rn']);
  const maxGroups = Number(props.maxGroups) || 50;

  // UMA escala para todos os painéis — calculada sobre o que será exibido.
  const domain = painel ? sharedDomain(groups, props.y, childStyle === 'graph.line' ? 'line' : 'bar') : null;

  return (
    <div className={painel ? 'repeat repeat-grid' : 'repeat'}>
      {total > maxGroups && (
        <div className="error">
          ⚠ {total} grupos — mostrando os primeiros {maxGroups} (maxGroups). Filtre ou aumente o limite.
        </div>
      )}
      {groups.map((g) => (
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
            <GroupChart
              rows={g.rows}
              x={props.x}
              y={props.y}
              line={childStyle === 'graph.line'}
              domain={domain}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function GroupChart({
  rows,
  x,
  y,
  line,
  domain,
}: {
  rows: any[];
  x: string;
  y: string;
  line: boolean;
  domain: { min: number; max: number } | null;
}) {
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
        palette: chartPaletteOf(settings?.theme),
        dark: settings?.theme?.mode === 'dark',
        yDomain: domain,
      }) as any
    );
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [rows, x, y, line, settings, domain]);
  return <div ref={el} style={{ height: PANEL_HEIGHT, width: '100%' }} />;
}
