// Construtor ÚNICO de opções ECharts para BarChart/LineChart/BubbleChart.
// Consumido por: componentes React (web) e runtimes de publish via StudioRuntime.
//
// Atributos do dialeto Evidence suportados:
//   x, y (string ou array p/ multi-série), title, yAxisTitle,
//   swapXY=true (barras horizontais), type=stacked|stacked100,
//   series=<coluna> (agrupa em séries), size=<coluna> (bubble),
//   yFmt=<fmt> (formato do eixo de valor e do tooltip: pct1, num0, brl…),
//   seriesLabels={["A","B"]} (rótulos das séries de y, na ordem — a legenda
//   deixa de mostrar o nome cru da coluna),
//   refLine={[{axis,value|from,label}]} (linhas de corte — ver refsOf).
import { formatNumber } from './format.js';

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [String(v)];
}

function labelsOf(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Linhas de referência do bloco. Cada item é {axis, label?} mais UMA origem do
 * valor: `value` (literal — limiares que são constantes de verdade, como 0 ou
 * 80%) ou `from` (coluna do resultado, lida na 1ª linha — é como uma mediana
 * entra no gráfico sem ninguém digitá-la).
 *   axis: 'y' = eixo de VALOR · 'x' = eixo de CATEGORIA.
 * Valor ausente ou não numérico não vira linha: referência inventada é pior
 * que referência ausente.
 */
function refsOf(raw, rows) {
  let list = raw;
  if (typeof raw === 'string') {
    if (!raw.trim().startsWith('[')) return [];
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const primeira = rows[0] || {};
  // ARRAY de dois = FAIXA (markArea); escalar = linha (markLine). Sem chave
  // nova: `from` já significa "ler de uma métrica" e reusá-la como "início do
  // intervalo" seria ambíguo. As mesmas duas chaves cobrem os dois casos.
  const num = (r, v) => Number(r && r.from !== undefined ? primeira[v] : v);
  return list
    .map((r) => {
      const bruto = r && r.from !== undefined ? r.from : r && r.value;
      const eixo = r && r.axis === 'x' ? 'x' : 'y';
      if (Array.isArray(bruto)) {
        if (bruto.length !== 2) return null;
        const [a, b] = bruto.map((v) => num(r, v));
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
        return { axis: eixo, de: Math.min(a, b), ate: Math.max(a, b), label: (r && r.label) || '', faixa: true };
      }
      const valor = num(r, bruto);
      return Number.isFinite(valor) ? { axis: eixo, value: valor, label: (r && r.label) || '' } : null;
    })
    .filter(Boolean);
}

/** Eixo do ECharts para uma referência: 'y' é sempre o eixo de VALOR. */
const eixoDe = (r, swap) => (r.axis === 'y' ? (swap ? 'xAxis' : 'yAxis') : swap ? 'yAxis' : 'xAxis');

/**
 * No eixo CATEGÓRICO o ECharts posiciona por índice, não por valor: o número
 * declarado é a categoria (n_areas_80 = 7), não a sétima barra.
 */
const posDe = (r, valor, catData) => {
  if (r.axis !== 'x') return valor;
  const i = (catData || []).findIndex((v) => Number(v) === valor);
  return i >= 0 ? i : valor;
};

/**
 * markArea do ECharts a partir das referências de FAIXA.
 *
 * É o que `SPEC_narrativa_relatorios.md` §7.3 mandava contornar com "um bloco
 * extra com `filters` no período": duas visões do mesmo dado no lugar de uma
 * marca. A faixa é silenciosa e fica ATRÁS das séries — ela é contexto, não
 * mais um dado competindo com o que o gráfico mostra.
 */
function markAreaOf(refs, { swap, catData, txt }) {
  return {
    silent: true,
    itemStyle: { color: txt, opacity: 0.08 },
    label: { show: true, position: 'insideTop', color: txt, opacity: 0.75, fontSize: 11 },
    data: refs.map((r) => {
      const chave = eixoDe(r, swap);
      return [
        { [chave]: posDe(r, r.de, catData), name: r.label || undefined },
        { [chave]: posDe(r, r.ate, catData) },
      ];
    }),
  };
}

/** markLine do ECharts a partir das referências já resolvidas. */
function markLineOf(refs, { swap, catData, txt, fmtVal }) {
  const data = refs.map((r) => {
    const chave = eixoDe(r, swap);
    return {
      [chave]: posDe(r, r.value, catData),
      name: r.label || undefined,
      label: { show: !!r.label, formatter: r.label, color: txt, position: r.axis === 'y' ? 'insideEndTop' : 'insideEndTop' },
    };
  });
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { type: 'dashed', width: 1.5, color: txt, opacity: 0.85 },
    label: { color: txt },
    tooltip: { formatter: (p) => (p.name ? p.name + ': ' : '') + fmtVal(p.value) },
    data,
  };
}

function axisLabelColor(dark) {
  return dark ? '#cfd3dc' : '#4b5563';
}

/** kind: 'bar' | 'line' | 'scatter'. Retorna option ECharts pronta. */
// `yDomain` ({min, max}) fixa o eixo de valor por fora — é o que faz painéis de
// pequenos múltiplos compartilharem escala (ver shared/smallMultiples.js).
// Ausente, o eixo segue automático, como sempre foi.
export function buildChartOption({ kind, rows, attrs, palette, dark, yDomain }) {
  rows = rows || [];
  const a = attrs || {};
  const x = a.x;
  const ys = asArray(a.y);
  const stacked = a.type === 'stacked' || a.type === 'stacked100';
  const pct100 = a.type === 'stacked100';
  const swap = String(a.swapXY) === 'true';
  const txt = axisLabelColor(dark);
  const yFmt = a.yFmt ? String(a.yFmt) : '';
  // Empilhado em 100%: to100 já devolve 0–100, então o número NÃO passa por
  // formatNumber (dividiria de novo) — leva o sinal de % direto. Sem isto o
  // eixo mostrava "80" sem dizer 80 de quê.
  const fmtVal = pct100 ? (v) => String(Number(v)).replace('.', ',') + '%' : (v) => (yFmt ? formatNumber(Number(v), yFmt) : v);
  const temFmt = pct100 || !!yFmt;
  const labels = labelsOf(a.seriesLabels);

  // Histograma: as barras se encostam porque o eixo é uma escala CONTÍNUA
  // fatiada, não categorias independentes. É o que sinaliza isso ao leitor.
  const contiguous = String(a.contiguous) === 'true';
  const catAxis = {
    type: 'category',
    name: a.xAxisTitle || undefined,
    nameLocation: a.xAxisTitle ? 'middle' : undefined,
    // Deitado o eixo de categoria vira o Y e o nome fica DO LADO dos rótulos,
    // que num histograma são intervalos formatados e longos: 30px encostaria o
    // nome neles. A folga grande vale só nesse caso.
    nameGap: a.xAxisTitle ? (swap ? 96 : 30) : undefined,
    data: rows.map((r) => r[x]),
    axisLabel: { color: txt, rotate: !swap && !contiguous && rows.length > 8 ? 30 : 0 },
    axisTick: contiguous ? { alignWithLabel: true } : undefined,
  };
  // Eixo de POSIÇÃO (bump): 1º lugar no topo, passo inteiro, sem suavização.
  // Inverter um eixo de valor só faz sentido para ranking — e curva suave num
  // bump inventaria posições fracionárias entre os períodos.
  const rankAxis = String(a.yInverted) === 'true';
  // Com o eixo automático o ECharts começava os ticks no 2: a 1ª posição, que é
  // a linha que o leitor procura, ficava sem marca. Num ranking curto cada
  // posição vira um tick.
  const rankMax = rankAxis ? Math.max(1, ...rows.map((r) => Number(r[ys[0]])).filter((v) => Number.isFinite(v))) : 0;
  const valAxis = {
    type: 'value',
    inverse: rankAxis || undefined,
    interval: rankAxis && rankMax <= 12 ? 1 : undefined,
    minInterval: rankAxis ? 1 : undefined,
    name: a.yAxisTitle || undefined,
    axisLabel: { color: txt, formatter: temFmt ? (v) => fmtVal(v) : undefined },
    // pct100 já tem domínio próprio (0–100) e vence o compartilhado.
    // Num eixo de posição o piso é 1: não existe "lugar zero".
    min: rankAxis ? 1 : !pct100 && yDomain ? yDomain.min : undefined,
    max: rankAxis ? rankMax : pct100 ? 100 : yDomain ? yDomain.max : undefined,
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
      smooth: kind === 'line' && !rankAxis,
      // Bump: sem dado no período a linha se INTERROMPE. Zero seria "caiu para
      // a posição 0", que não existe.
      data: cats.map((c) => (rankAxis ? byCat[c] ?? null : byCat[c] ?? 0)),
      symbolSize: rankAxis ? 7 : undefined,
      lineStyle: rankAxis ? { width: 2.5 } : undefined,
      connectNulls: rankAxis ? false : undefined,
    }));
    catAxis.data = cats;
    if (pct100) to100(series, cats.length);
  } else {
    // Uma série por coluna de y (multi-série via y={["a","b"]}).
    series = ys.map((col, i) => ({
      name: labels[i] || col,
      type: kind,
      stack: stacked ? 'total' : undefined,
      smooth: kind === 'line' && !rankAxis,
      areaStyle: kind === 'line' && !rankAxis && ys.length === 1 ? { opacity: 0.12 } : undefined,
      barCategoryGap: contiguous ? 0 : undefined,
      itemStyle: kind === 'bar' && !swap && !contiguous ? { borderRadius: [3, 3, 0, 0] } : undefined,
      data: rows.map((r) => Number(r[col])),
    }));
    if (pct100) to100(series, rows.length);
  }

  // Referências vão na PRIMEIRA série: o markLine é desenhado uma vez, sobre a
  // grade inteira, e não uma por série.
  const refs = refsOf(a.refLine, rows);
  const linhas = refs.filter((r) => !r.faixa);
  const faixas = refs.filter((r) => r.faixa);
  if (refs.length && series.length)
    series[0] = {
      ...series[0],
      ...(linhas.length ? { markLine: markLineOf(linhas, { swap, catData: catAxis.data, txt, fmtVal }) } : {}),
      ...(faixas.length ? { markArea: markAreaOf(faixas, { swap, catData: catAxis.data, txt }) } : {}),
    };

  const xAxis = kind === 'scatter' ? { type: 'value', axisLabel: { color: txt } } : swap ? valAxis : catAxis;
  const yAxis = kind === 'scatter' ? { ...valAxis, max: undefined } : swap ? catAxis : valAxis;
  const showLegend = series.length > 1;

  return {
    color: palette,
    backgroundColor: 'transparent',
    title: a.title
      ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600, color: dark ? '#e5e7eb' : '#1d1d20' } }
      : undefined,
    tooltip: { trigger: kind === 'scatter' ? 'item' : 'axis', valueFormatter: temFmt ? (v) => fmtVal(v) : undefined },
    legend: showLegend ? { top: a.title ? 28 : 4, textStyle: { color: txt } } : undefined,
    grid: {
      // Deitado, o espaço que o título do eixo pede é à ESQUERDA (junto dos
      // rótulos de categoria), não embaixo.
      left: swap ? (a.xAxisTitle ? 168 : 140) : 56,
      right: 16,
      top: (a.title ? 44 : 16) + (showLegend ? 24 : 0),
      bottom: !swap && a.xAxisTitle ? 64 : 48,
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

// ---------------------------------------------------------------------------
// MARCA DE INTERVALO — a forma que faltava para a dispersão.
//
// O catálogo aprendeu a calcular p25/mediana/p75, mas o produto só sabia
// desenhá-los como três colunas de tabela ou três barras lado a lado — que
// mostram três números e escondem a única coisa que importa: a FAIXA onde a
// maioria cai, e onde o centro está dentro dela.
//
// Cada categoria vira uma haste do mínimo ao máximo, com tampas nas pontas e um
// ponto no centro. Uma marca por categoria, não três.
//
// attrs: x (categoria), low, mid, high (colunas), yFmt, title, yAxisTitle.
export function buildRangeOption({ rows, attrs, palette, dark }) {
  const a = attrs || {};
  const txt = axisLabelColor(dark);
  const cor = (palette && palette[0]) || '#2c8a4a';
  const yFmt = a.yFmt ? String(a.yFmt) : '';
  const fmtVal = (v) => (yFmt ? formatNumber(Number(v), yFmt) : v);
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

  // [categoria, mínimo, centro, máximo] — encode informa ao ECharts que os três
  // valores entram no domínio do eixo, senão a faixa sai cortada.
  const data = (rows || [])
    .map((r) => [String(r[a.x]), num(r[a.low]), num(r[a.mid]), num(r[a.high])])
    .filter((d) => Number.isFinite(d[1]) && Number.isFinite(d[2]) && Number.isFinite(d[3]));

  return {
    color: palette,
    backgroundColor: 'transparent',
    title: a.title
      ? { text: a.title, textStyle: { fontSize: 14, fontWeight: 600, color: dark ? '#e5e7eb' : '#1d1d20' } }
      : undefined,
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const [cat, lo, mid, hi] = p.value;
        return `${cat}<br/>máximo: <b>${fmtVal(hi)}</b><br/>centro: <b>${fmtVal(mid)}</b><br/>mínimo: <b>${fmtVal(lo)}</b>`;
      },
    },
    grid: { left: 56, right: 16, top: a.title ? 44 : 16, bottom: 48 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d[0]),
      axisLabel: { color: txt, rotate: data.length > 8 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      name: a.yAxisTitle || undefined,
      axisLabel: { color: txt, formatter: yFmt ? (v) => fmtVal(v) : undefined },
    },
    series: [
      {
        type: 'custom',
        encode: { x: 0, y: [1, 2, 3] },
        data,
        // mesma semântica do BarChart/LineChart: 'y' = eixo de valor
        markLine: (() => {
          const refs = refsOf(a.refLine, rows || []).filter((r) => !r.faixa);
          return refs.length ? markLineOf(refs, { swap: false, catData: data.map((d) => d[0]), txt, fmtVal }) : undefined;
        })(),
        markArea: (() => {
          const refs = refsOf(a.refLine, rows || []).filter((r) => r.faixa);
          return refs.length ? markAreaOf(refs, { swap: false, catData: data.map((d) => d[0]), txt }) : undefined;
        })(),
        renderItem: (params, api) => {
          const i = api.value(0);
          const pLo = api.coord([i, api.value(1)]);
          const pMid = api.coord([i, api.value(2)]);
          const pHi = api.coord([i, api.value(3)]);
          // tampa proporcional à faixa da categoria, com limites legíveis
          const cap = Math.max(5, Math.min(16, (api.size([1, 0])[0] || 20) * 0.26));
          const haste = { stroke: cor, lineWidth: 2 };
          return {
            type: 'group',
            children: [
              { type: 'line', shape: { x1: pLo[0], y1: pLo[1], x2: pHi[0], y2: pHi[1] }, style: haste },
              { type: 'line', shape: { x1: pLo[0] - cap, y1: pLo[1], x2: pLo[0] + cap, y2: pLo[1] }, style: haste },
              { type: 'line', shape: { x1: pHi[0] - cap, y1: pHi[1], x2: pHi[0] + cap, y2: pHi[1] }, style: haste },
              { type: 'circle', shape: { cx: pMid[0], cy: pMid[1], r: 4.5 }, style: { fill: cor } },
            ],
          };
        },
      },
    ],
  };
}
