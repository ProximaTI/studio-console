import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { usePreview } from '../markdown';
import { buildAreaMapOption } from '../../../../shared/mapOption.js';

// Mapa coroplético (Evidence <AreaMap/>). Suporte focado no caso Brasil-UF:
// usa o GeoJSON local (/maps/brazil.geo.json) em vez de baixar o geoJsonUrl,
// casando as áreas pela propriedade indicada em geoId (ex.: sigla).
// A opção ECharts vem de shared/mapOption.js (buildAreaMapOption) — o MESMO
// código dos apps publicados; props extras: colorPalette, showLabels.
const registered = new Set<string>();

export default function AreaMap(props: any) {
  const { dataMap, errors, settings } = usePreview();
  const el = useRef<HTMLDivElement>(null);
  const rows = dataMap[props.data] || [];
  const nameProp = props.geoId || 'sigla';
  const err = errors[props.data];
  const dark = settings?.theme?.mode === 'dark';
  const palette: string[] = settings?.theme?.chartPalette || ['#236aa4'];

  useEffect(() => {
    if (!el.current || err || rows.length === 0) return;
    let disposed = false;
    const mapName = 'brazil-' + nameProp;

    (async () => {
      if (!registered.has(mapName)) {
        const geo = await fetch('/maps/brazil.geo.json').then((r) => r.json());
        if (disposed) return;
        echarts.registerMap(mapName, geo);
        registered.add(mapName);
      }
      if (disposed || !el.current) return;
      const chart = echarts.init(el.current);
      chart.setOption(buildAreaMapOption({ rows, attrs: props, palette, dark, mapName }));
      (el.current as any).__chart = chart;
    })();

    return () => {
      disposed = true;
      const c = (el.current as any)?.__chart;
      if (c) c.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rows), props.areaCol, props.value, props.colorPalette, props.showLabels, props.title, dark, err]);

  if (err) return <div className="error">{err}</div>;
  if (rows.length === 0) return <div className="muted">Sem dados para o mapa.</div>;
  return <div ref={el} style={{ width: '100%', height: Number(props.height) || 480 }} />;
}
