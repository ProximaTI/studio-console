import ReactECharts from 'echarts-for-react';
import { usePreview } from '../markdown';
import { buildTreemapOption } from '../../../../shared/chartOption.js';
import { chartPaletteOf } from '../../../../shared/designTokens.js';

export default function Treemap(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  const option = buildTreemapOption({
    rows: dataMap[props.data] || [],
    attrs: props,
    palette: chartPaletteOf(settings?.theme),
    dark: settings?.theme?.mode === 'dark',
  });
  return <ReactECharts option={option} style={{ height: Number(props.height) || 420 }} notMerge />;
}
