import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { usePreview } from '../markdown';
import { buildPointMapOption } from '../../../../shared/mapOption.js';
import { chartPaletteOf } from '../../../../shared/designTokens.js';

// O GeoJSON é o MESMO do AreaMap; registra uma vez por nome.
const registrados = new Set<string>();

export default function PointMap(props: any) {
  const { dataMap, errors, settings } = usePreview();
  const [pronto, setPronto] = useState(registrados.has('brazil'));

  useEffect(() => {
    if (registrados.has('brazil')) return;
    fetch('/maps/brazil.geo.json')
      .then((r) => r.json())
      .then((geo) => {
        echarts.registerMap('brazil', geo);
        registrados.add('brazil');
        setPronto(true);
      })
      .catch(() => setPronto(false));
  }, []);

  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  if (!pronto) return <div className="muted">Carregando mapa…</div>;
  const option = buildPointMapOption({
    rows: dataMap[props.data] || [],
    attrs: props,
    palette: chartPaletteOf(settings?.theme),
    dark: settings?.theme?.mode === 'dark',
    mapName: 'brazil',
  });
  return <ReactECharts option={option} style={{ height: Number(props.height) || 460 }} notMerge />;
}
