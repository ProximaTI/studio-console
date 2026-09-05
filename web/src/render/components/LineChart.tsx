import ReactECharts from 'echarts-for-react';
import { usePreview } from '../markdown';
import { buildChartOption } from '../../../../shared/chartOption.js';

export default function LineChart(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  const rows = dataMap[props.data] || [];
  const option = buildChartOption({
    kind: 'line',
    rows,
    attrs: props,
    palette: settings?.theme?.chartPalette,
    dark: settings?.theme?.mode === 'dark',
  });
  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}
