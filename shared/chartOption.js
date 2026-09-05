// Construtor ÚNICO de opções ECharts para BarChart/LineChart/BubbleChart.
// Consumido por: componentes React (web) e runtimes de publish via StudioRuntime.
//
// Atributos do dialeto Evidence suportados:
//   x, y (string ou array p/ multi-série), title, yAxisTitle,
//   swapXY=true (barras horizontais), type=stacked|stacked100,
//   series=<coluna> (agrupa em séries), size=<coluna> (bubble).

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [String(v)];
}

function axisLabelColor(dark) {
  return dark ? '#cfd3dc' : '#4b5563';
}

/** kind: 'bar' | 'line' | 'scatter'. Retorna option ECharts pronta. */
export function buildChartOption({ kind, rows, attrs, palette, dark }) {
  rows = rows || [];
  const a = attrs || {};
  const x = a.x;
  const ys = asArray(a.y);
  const stacked = a.type === 'stacked' || a.type === 'stacked100';
  const pct100 = a.type === 'stacked100';
  const swap = String(a.swapXY) === 'true';
  const txt = axisLabelColor(dark);

  const catAxis = {
    type: 'category',
    data: rows.map((r) => r[x]),
    axisLabel: { color: txt, rotate: !swap && rows.length > 8 ? 30 : 0 },
  };
  const valAxis = {
    type: 'value',
    name: a.yAxisTitle || undefined,
    axisLabel: { color: txt },
    max: pct100 ? 100 : undefined,
  };

  let series;
  if (kind === 'scatter') {
    // Bubble: agrupa por a.series; size = coluna opcional (escala por raiz).
    const sizeCol = a.size;
    const sizes = sizeCol ? rows.map((r) => Number(r[sizeCol]) || 0) : [];
    const maxS = Math.max(1, ...sizes);
    const mk = (rs) => ({
      type: 'scatter',
      data: rs.map((r) => ({
        value: [Number(r[x]), Number(r[ys[0]])],
        name: a.label ? r[a.label] : undefined,
        symbolSize: sizeCol ? 8 + 32 * Math.sqrt((Number(r[sizeCol]) || 0) / maxS) : 12,
      })),
    });
    if (a.series) {
      const groups = {};
      for (const r of rows) (groups[r[a.series]] = groups[r[a.series]] || []).push(r);
      series = Object.entries(groups).map(([name, rs]) => ({ name, ...mk(rs) }));
    } else {
      series = [mk(rows)];
    }
  } else if (a.series && ys.length <= 1) {
    // Uma métrica quebrada em séries por coluna categórica.
    const yCol = ys[0];
    const cats = [...new Set(rows.map((r) => r[x]))];
    const groups = {};
    for (const r of rows) (groups[r[a.series]] = groups[r[a.series]] || {})[r[x]] = Number(r[yCol]);
    series = Object.entries(groups).map(([name, byCat]) => ({
      name,
      type: kind,
      stack: stacked ? 'total' : undefined,
      smooth: kind === 'line',
      data: cats.map((c) => byCat[c] ?? 0),
    }));
    catAxis.data = cats;
    if (pct100) to100(series, cats.length);
  } else {
    // Uma série por coluna de y (multi-série via y={["a","b"]}).
    series = ys.map((col) => ({
      name: col,
      type: kind,
      stack: stacked ? 'total' : undefined,
      smooth: kind === 'line',
      areaStyle: kind === 'line' && ys.length === 1 ? { opacity: 0.12 } : undefined,
      itemStyle: kind === 'bar' && !swap ? { borderRadius: [3, 3, 0, 0] } : undefined,
      data: rows.map((r) => Number(r[col])),
    }));
    if (pct100) to100(series, rows.length);
  }

  const xAxis = kind === 'scatter' ? { type: 'value', axisLabel: { color: txt } } : swap ? valAxis : catAxis;
  const yAxis = kind === 'scatter' ? { ...valAxis, max: undefined } : swap ? catAxis : valAxis;
  const showLegend = series.length > 1;

  return {
    color: palette,
    backgroundColor: 'transparent',
    title: a.title
      ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600, color: dark ? '#e5e7eb' : '#1d1d20' } }
      : undefined,
    tooltip: { trigger: kind === 'scatter' ? 'item' : 'axis' },
    legend: showLegend ? { top: a.title ? 28 : 4, textStyle: { color: txt } } : undefined,
    grid: {
      left: swap ? 140 : 56,
      right: 16,
      top: (a.title ? 44 : 16) + (showLegend ? 24 : 0),
      bottom: 48,
      containLabel: swap,
    },
    xAxis,
    yAxis,
    series,
  };
}

// Converte séries empilhadas em percentual (cada categoria soma 100).
function to100(series, nCats) {
  for (let c = 0; c < nCats; c++) {
    let sum = 0;
    for (const s of series) sum += Number(s.data[c]) || 0;
    if (sum > 0) for (const s of series) s.data[c] = Math.round(((Number(s.data[c]) || 0) / sum) * 1000) / 10;
  }
}
