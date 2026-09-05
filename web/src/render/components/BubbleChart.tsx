import ReactECharts from 'echarts-for-react';
import { usePreview } from '../markdown';
import { buildChartOption } from '../../../../shared/chartOption.js';

// Scatter/bubble: x, y, size (coluna opcional), series (agrupamento opcional).
export default function BubbleChart(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  const rows = dataMap[props.data] || [];
  const option = buildChartOption({
    kind: 'scatter',
    rows,
    attrs: props,
    palette: settings?.theme?.chartPalette,
    dark: settings?.theme?.mode === 'dark',
  });
  return <ReactECharts option={option} style={{ height: 360 }} notMerge />;
}
