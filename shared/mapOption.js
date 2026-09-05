// Opção ECharts do ConnectionMap (geo + arcos + pontos) — código ÚNICO.
// Consumido pelo componente React (editor) e, via bundle StudioRuntime, pelos apps publicados.
//
// rows: arestas com colunas de coordenadas (fromLat/fromLon/toLat/toLon, weight, nomes).
// Os pontos são deduzidos das pontas; tamanho do ponto = soma dos pesos incidentes.

export function buildMapOption({ rows, attrs, palette, dark }) {
  const a = attrs || {};
  const mapName = a.map === 'brazil' ? 'brazil' : 'world';
  const fLat = a.fromLat || 'from_lat';
  const fLon = a.fromLon || 'from_lon';
  const tLat = a.toLat || 'to_lat';
  const tLon = a.toLon || 'to_lon';
  const fName = a.fromName || a.from || 'from';
  const tName = a.toName || a.to || 'to';
  const wCol = a.weight;
  const animated = a.animated === 'true' || a.animated === '';

  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

  const edges = (rows || [])
    .map((r) => {
      const A = [num(r[fLon]), num(r[fLat])];
      const B = [num(r[tLon]), num(r[tLat])];
      const w = wCol ? num(r[wCol]) || 1 : 1;
      return {
        coords: [A, B],
        w,
        fromName: r[fName] != null ? String(r[fName]) : '',
        toName: r[tName] != null ? String(r[tName]) : '',
      };
    })
    .filter((e) => e.coords.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])));

  const nodeMap = new Map();
  const addNode = (lon, lat, name, w) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const key = lon.toFixed(3) + ',' + lat.toFixed(3);
    const cur = nodeMap.get(key);
    if (cur) cur.value[2] += w;
    else nodeMap.set(key, { name: name || key, value: [lon, lat, w] });
  };
  for (const e of edges) {
    addNode(e.coords[0][0], e.coords[0][1], e.fromName, e.w);
    addNode(e.coords[1][0], e.coords[1][1], e.toName, e.w);
  }
  const nodes = [...nodeMap.values()];

  const maxW = Math.max(1, ...edges.map((e) => e.w));
  const maxNode = Math.max(1, ...nodes.map((n) => n.value[2]));
  const primary = (palette && palette[0]) || '#236aa4';
  const accent = (palette && palette[3]) || '#7b61ff';

  return {
    title: a.title ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600 } } : undefined,
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        if (p.seriesType === 'lines') {
          const d = p.data;
          return `${d.fromName || '?'} → ${d.toName || '?'}<br/>volume: <b>${d.w}</b>`;
        }
        return `${p.name}<br/>colaborações: <b>${Math.round(p.value[2])}</b>`;
      },
    },
    geo: {
      map: mapName,
      roam: true,
      itemStyle: { areaColor: dark ? '#2a2f3a' : '#eef1f5', borderColor: dark ? '#3a3a40' : '#cfd6df' },
      emphasis: { itemStyle: { areaColor: dark ? '#343b49' : '#e2e8f0' }, label: { show: false } },
    },
    series: [
      {
        type: 'lines',
        coordinateSystem: 'geo',
        zlevel: 1,
        effect: animated ? { show: true, period: 5, trailLength: 0.4, symbol: 'arrow', symbolSize: 5 } : { show: false },
        lineStyle: { color: accent, opacity: 0.5, curveness: 0.3, width: 1 },
        data: edges.map((e) => ({
          coords: e.coords,
          fromName: e.fromName,
          toName: e.toName,
          w: e.w,
          lineStyle: { width: 1 + (e.w / maxW) * 7 }, // largura ∝ volume
        })),
      },
      {
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 2,
        itemStyle: { color: primary, opacity: 0.85 },
        emphasis: { scale: 1.3 },
        symbolSize: (val) => 6 + (val[2] / maxNode) * 26, // tamanho ∝ colaboração
        data: nodes,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// AreaMap (coroplético por área, ex.: Brasil por UF) — código ÚNICO para o
// componente React do editor e para o runtime dos apps publicados.
//
// attrs: areaCol (coluna com o id da área), value (métrica), geoId (propriedade
//   do GeoJSON casada com areaCol; default 'sigla'), title, height,
//   colorPalette (lista de cores do degradê claro→escuro, sintaxe Evidence
//   colorPalette={['#eee','#236aa4']} ou "#eee,#236aa4"; com 3+ cores os tons
//   intermediários ficam sob controle da página), showLabels=true (imprime o
//   valor formatado dentro de cada área — extensão da console, o Evidence só
//   mostra no tooltip).

/** "['#a','#b']" | "#a,#b" | ['#a','#b'] -> ['#a','#b'] (strings limpas). */
export function parseColorList(v) {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v : String(v).split(',');
  return raw
    .map((c) => String(c).replace(/[\[\]'"\s]/g, ''))
    .filter(Boolean);
}

/** Layout do rótulo de uma área (ECharts labelLayout): área com menos de
 *  AREA_LABEL_MIN_PX de largura ou altura -> rótulo à direita com linha-guia. */
export const AREA_LABEL_MIN_PX = 18;
export function areaLabelLayout(p) {
  const r = p && p.rect;
  if (!r) return {};
  if (Math.min(r.width, r.height) < AREA_LABEL_MIN_PX) {
    const y = r.y + r.height / 2;
    const x1 = r.x + r.width;
    return { x: x1 + 34, y, align: 'left', verticalAlign: 'middle', labelLinePoints: [[x1, y], [x1 + 30, y]] };
  }
  return { moveOverlap: 'shiftY' };
}

export function buildAreaMapOption({ rows, attrs, palette, dark, mapName }) {
  const a = attrs || {};
  const fmtInt = (v) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR'));
  const data = (rows || []).map((r) => ({ name: String(r[a.areaCol]), value: Number(r[a.value]) || 0 }));
  let max = 1;
  data.forEach((d) => {
    if (d.value > max) max = d.value;
  });
  const custom = parseColorList(a.colorPalette);
  const colors = custom.length >= 2 ? custom : [dark ? '#1d2330' : '#eef2f7', (palette && palette[0]) || '#236aa4'];
  const showLabels = a.showLabels === 'true' || a.showLabels === '' || a.showLabels === true;
  const textColor = dark ? '#e5e7eb' : '#1d1d20';

  return {
    backgroundColor: 'transparent',
    title: a.title ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600, color: textColor } } : undefined,
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${fmtInt(p.value)}` },
    visualMap: {
      min: 0,
      max,
      left: 8,
      bottom: 8,
      calculable: true,
      inRange: { color: colors },
      textStyle: { color: dark ? '#cfd3dc' : '#4b5563' },
    },
    series: [
      {
        type: 'map',
        map: mapName || 'brazil',
        nameProperty: a.geoId || 'sigla',
        roam: true,
        label: {
          show: showLabels,
          fontSize: 10,
          fontWeight: 600,
          color: textColor,
          textBorderColor: dark ? '#111827' : '#ffffff',
          textBorderWidth: 2,
          formatter: (p) => fmtInt(p.value),
        },
        // Todo estado mostra sua quantidade — nada é escondido por sobreposição:
        // áreas pequenas (DF dentro de GO, SE…) recebem o rótulo FORA, à direita,
        // com linha-guia; as demais só deslocam na vertical se colidirem.
        labelLayout: areaLabelLayout,
        labelLine: { show: showLabels, lineStyle: { color: dark ? '#9ca3af' : '#374151', width: 1 } },
        emphasis: {
          label: { show: true, fontSize: 11, formatter: (p) => `${p.name}\n${fmtInt(p.value)}` },
        },
        itemStyle: { borderColor: dark ? '#374151' : '#cbd5e1' },
        data,
      },
    ],
  };
}
