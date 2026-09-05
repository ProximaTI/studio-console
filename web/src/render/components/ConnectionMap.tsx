import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { usePreview } from '../markdown';
import { buildMapOption } from '../mapOption';

// Mapa de conexões geográficas (instituições/países) com arcos largura ∝ volume.
// Uso no markdown:
//   <ConnectionMap map=world data={colab_paises}
//     fromLat=la fromLon=lo toLat=lb toLon=ob fromName=pa toName=pb weight=n title="..."/>
// Mapas: map=world (mundo) | map=brazil (Brasil).
const GEO_URL: Record<string, string> = {
  world: '/maps/world.geo.json',
  brazil: '/maps/brazil.geo.json',
};
const registered: Record<string, boolean> = {};

export default function ConnectionMap(props: any) {
  const { dataMap, errors, settings } = usePreview();
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [ready, setReady] = useState(registered[props.map === 'brazil' ? 'brazil' : 'world'] || false);
  const [loadErr, setLoadErr] = useState('');

  const mapName = props.map === 'brazil' ? 'brazil' : 'world';

  // Carrega e registra o GeoJSON uma vez por mapa.
  useEffect(() => {
    let cancelled = false;
    if (registered[mapName]) {
      setReady(true);
      return;
    }
    fetch(GEO_URL[mapName])
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled) return;
        echarts.registerMap(mapName, geo);
        registered[mapName] = true;
        setReady(true);
      })
      .catch((e) => !cancelled && setLoadErr('Falha ao carregar mapa: ' + e.message));
    return () => {
      cancelled = true;
    };
  }, [mapName]);

  // (Re)desenha quando dados/mapa mudam.
  useEffect(() => {
    if (!ready || !divRef.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(divRef.current, settings?.theme?.mode === 'dark' ? 'dark' : undefined);
    const rows = dataMap[props.data] || [];
    const option = buildMapOption({
      rows,
      attrs: props,
      palette: settings?.theme?.chartPalette,
      dark: settings?.theme?.mode === 'dark',
    });
    chartRef.current.setOption(option as any, true);
  }, [ready, props, dataMap, settings]);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => () => chartRef.current?.dispose(), []);

  if (errors[props.data]) return <div className="error">{errors[props.data]}</div>;
  if (loadErr) return <div className="error">{loadErr}</div>;
  const height = props.height ? Number(props.height) : 460;
  return <div ref={divRef} style={{ height, width: '100%' }} className="connmap" />;
}
