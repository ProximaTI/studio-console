import { formatNumber } from './format.js';
// Opção ECharts do ConnectionMap (geo + arcos + pontos) — código ÚNICO.
// Consumido pelo componente React (editor) e, via bundle StudioRuntime, pelos apps publicados.
//
// rows: arestas com colunas de coordenadas (fromLat/fromLon/toLat/toLon, weight, nomes).
// Os pontos são deduzidos das pontas; tamanho do ponto = soma dos pesos incidentes.

import { chartPaletteOf } from './designTokens.js';

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
  const primary = chartPaletteOf({ chartPalette: palette })[0];
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
//   colorPalette={['#eee','#2c8a4a']} ou "#eee,#2c8a4a"; com 3+ cores os tons
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
  // O `fmt` da métrica chega até aqui: sem ele uma taxa saía crua ("0,539")
  // no rótulo, na legenda e no tooltip, em vez de "53,9%".
  const fmtInt = (v) => (v == null || isNaN(v) ? '—' : a.fmt ? formatNumber(Number(v), a.fmt) : Number(v).toLocaleString('pt-BR'));
  const data = (rows || []).map((r) => ({ name: String(r[a.areaCol]), value: Number(r[a.value]) || 0 }));
  // Domínio da cor = faixa REAL do dado. Ancorar em zero quando nenhuma área
  // chega perto de zero gasta a escala inteira e achata o mapa — era o que
  // acontecia com toda métrica normalizada (as taxas por UF ficam entre 0,45 e
  // 0,66, e o mapa saía de uma cor só).
  const vals = data.map((d) => d.value);
  let min = vals.length ? Math.min(...vals) : 0;
  let max = vals.length ? Math.max(...vals) : 1;
  if (min === max) { min = Math.min(0, min); max = max || 1; }
  const custom = parseColorList(a.colorPalette);
  const colors = custom.length >= 2 ? custom : [dark ? '#1d2330' : '#eef2f7', chartPaletteOf({ chartPalette: palette })[0]];
  const showLabels = a.showLabels === 'true' || a.showLabels === '' || a.showLabels === true;
  const textColor = dark ? '#e5e7eb' : '#1d1d20';

  return {
    backgroundColor: 'transparent',
    title: a.title ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600, color: textColor } } : undefined,
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${fmtInt(p.value)}` },
    visualMap: {
      min,
      max,
      formatter: (v) => fmtInt(v),
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

// ---------------------------------------------------------------------------
// PointMap (símbolo proporcional por UF) — a resposta ao viés do coroplético.
//
// O `areamap` colore a ÁREA, então uma contagem absoluta vira um mapa do
// tamanho dos estados e da população: "artigos por UF" acende São Paulo porque
// São Paulo é grande e populoso, não porque a taxa é alta. A saída registrada
// no `breaks` do areamap era "use uma métrica normalizada" — um conselho, não
// um destino. O símbolo proporcional é o destino: a ÁREA DO CÍRCULO codifica a
// magnitude e não herda a distorção da fronteira.
//
// attrs: areaCol (coluna com a sigla), value (métrica), fmt, title,
//   colorPalette (a 1ª cor pinta os símbolos), showLabels=true (sigla + valor).

/**
 * Centróide de cada UF, por ÁREA do maior anel do GeoJSON já embutido.
 *
 * Fica no código, e não numa tabela que o usuário teria de juntar na query,
 * porque é GEOGRAFIA DE REFERÊNCIA — do mesmo tipo que o GeoJSON: não muda com
 * o projeto, e exigir preparo de dado para desenhar um mapa afastaria o estilo
 * de quem tem só uma coluna de sigla. Média de vértices enviesaria onde o
 * litoral é recortado (PA, AM, RJ), que é justamente onde o rótulo importa.
 */
export const UF_CENTROIDS = {
  AC: [-70.45, -9.31], AL: [-36.62, -9.51], AM: [-64.7, -4.18], AP: [-51.96, 1.44],
  BA: [-41.72, -12.47], CE: [-39.62, -5.09], DF: [-47.8, -15.78], ES: [-40.67, -19.57],
  GO: [-49.62, -16.04], MA: [-45.28, -5.06], MG: [-44.67, -18.46], MS: [-54.85, -20.33],
  MT: [-55.91, -12.95], PA: [-53.07, -3.97], PB: [-36.83, -7.12], PE: [-38, -8.33],
  PI: [-42.97, -7.39], PR: [-51.62, -24.64], RJ: [-42.65, -22.19], RN: [-36.67, -5.84],
  RO: [-62.84, -10.91], RR: [-61.4, 2.08], RS: [-53.32, -29.71], SC: [-50.49, -27.24],
  SE: [-37.44, -10.58], SP: [-48.73, -22.26], TO: [-48.33, -10.15],
};

export function buildPointMapOption({ rows, attrs, palette, dark, mapName }) {
  const a = attrs || {};
  const txt = dark ? '#cfd3dc' : '#4b5563';
  const textColor = dark ? '#e5e7eb' : '#1d1d20';
  const fmtInt = (v) => (v == null || isNaN(v) ? '—' : a.fmt ? formatNumber(Number(v), a.fmt) : Number(v).toLocaleString('pt-BR'));
  const custom = parseColorList(a.colorPalette);
  const cor = custom.length ? custom[custom.length - 1] : chartPaletteOf({ chartPalette: palette })[0];

  // Sigla sem centróide conhecido NÃO vira ponto em (0,0) no meio do Atlântico:
  // some do mapa, e o tooltip do que sobrou continua verdadeiro.
  const pontos = (rows || [])
    .map((r) => {
      const sigla = String(r[a.areaCol] ?? '').trim().toUpperCase();
      const c = UF_CENTROIDS[sigla];
      const v = Number(r[a.value]);
      return c && Number.isFinite(v) ? { name: sigla, value: [c[0], c[1], v] } : null;
    })
    .filter(Boolean);
  const max = pontos.length ? Math.max(...pontos.map((p) => p.value[2])) : 1;

  return {
    backgroundColor: 'transparent',
    title: a.title ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600, color: textColor } } : undefined,
    tooltip: { trigger: 'item', formatter: (p) => `${p.name}: ${fmtInt(p.value[2])}` },
    geo: {
      map: mapName || 'brazil',
      roam: true,
      itemStyle: { areaColor: dark ? '#1d2330' : '#eef2f7', borderColor: dark ? '#39404d' : '#cbd5e1' },
      emphasis: { itemStyle: { areaColor: dark ? '#252c3a' : '#e2e8f0' }, label: { show: false } },
    },
    series: [
      {
        type: 'scatter',
        coordinateSystem: 'geo',
        itemStyle: { color: cor, opacity: 0.8 },
        emphasis: { scale: 1.2 },
        // ÁREA ∝ valor, então o RAIO vai com a RAIZ — e sem somar um piso.
        // Um `base + k·√v` parece inofensivo e destrói a proporção: com base 6 e
        // k 30, um valor 25× maior desenha uma área só 9× maior. Escalar o raio
        // LINEARMENTE com o valor é o erro oposto e mais comum, e exagera a
        // diferença ao quadrado.
        // Consequência aceita: valor perto de zero desenha quase nada. É o que
        // deve acontecer — um piso faria o irrelevante parecer presente.
        symbolSize: (val) => 34 * Math.sqrt(Math.max(0, val[2]) / (max || 1)),
        label: {
          show: a.showLabels === 'true' || a.showLabels === '' || a.showLabels === true,
          formatter: (p) => `${p.name}\n${fmtInt(p.value[2])}`,
          position: 'right',
          color: txt,
          fontSize: 10,
        },
        data: pontos,
      },
    ],
  };
}
