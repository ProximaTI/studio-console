import ReactECharts from 'echarts-for-react';
import { usePreview } from '../markdown';
import { buildRangeOption } from '../../../../shared/chartOption.js';
import { chartPaletteOf } from '../../../../shared/designTokens.js';

// <RangeChart data={q} x=unidade low=ticket_p25 mid=ticket_mediana high=ticket_p75 yFmt=brl/>
// Marca de INTERVALO: uma haste por categoria, do mínimo ao máximo, com o centro
// marcado — a forma que o catálogo passou a poder alimentar quando ganhou
// median/p25/p75. A opção vem de shared/chartOption.js, a mesma dos publicados.
export default function RangeChart(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  const rows = dataMap[props.data] || [];
  const option = buildRangeOption({
    rows,
    attrs: props,
    palette: chartPaletteOf(settings?.theme),
    dark: settings?.theme?.mode === 'dark',
  });
  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}
