import ReactECharts from 'echarts-for-react';
import { usePreview } from '../markdown';
import { buildChartOption } from '../../../../shared/chartOption.js';

export default function BarChart(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  const rows = dataMap[props.data] || [];
  const option = buildChartOption({
    kind: 'bar',
    rows,
    attrs: props,
    palette: settings?.theme?.chartPalette,
    dark: settings?.theme?.mode === 'dark',
  });
  // Barras horizontais com muitas categorias precisam de mais altura.
  const h = String(props.swapXY) === 'true' ? Math.max(320, 40 + rows.length * 26) : 320;
  return <ReactECharts option={option} style={{ height: h }} notMerge />;
}
