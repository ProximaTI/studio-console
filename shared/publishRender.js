// Runtime ÚNICO de render dos apps publicados (snapshot 📦 e Universal SQL ☁).
// Antes existiam dois renderComponent duplicados como strings de template em
// server/publish.js — e o do snapshot ficou para trás (sem Details/Grid/Column/
// AreaMap/busca/CSV). Este módulo entra no bundle StudioRuntime e é usado pelos
// DOIS bootstraps; o editor React continua com seus próprios componentes.
//
// createPublishRenderer(ctx) — ctx fornecido pelo bootstrap da página:
//   echarts, md                photo globals da página (echarts + markdown-it)
//   theme, decimalSeparator    do payload
//   maps                       { nome: geojson } embutidos
//   paramPages                 { dir: paramName } (links /dir/valor/)
//   hrefMode                   'app' (../x-app/app.html) | 'snapshot' (./x.html)
//   dataFor(name)              rows da query (ou { __error })
//   renderInline(text)         interpolação {expr} com o estado atual
//   getInput(name)             valor atual de um input
//   setInput(name, value)      async: re-executa/re-renderiza (papel do bootstrap)
import { formatNumber } from './format.js';
import { buildChartOption } from './chartOption.js';
import { buildMapOption, buildAreaMapOption } from './mapOption.js';

export function createPublishRenderer(ctx) {
  const charts = [];
  const settingsLike = { organization: { decimalSeparator: ctx.decimalSeparator || ',' } };
  const dark = ctx.theme && ctx.theme.mode === 'dark';
  const palette = (ctx.theme && ctx.theme.chartPalette) || undefined;
  let mapsRegistered = false;

  const fmt = (v, f) => formatNumber(v, f, settingsLike);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const htmlesc = (s) =>
    String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function ensureMaps() {
    if (mapsRegistered || !ctx.maps) return;
    for (const k of Object.keys(ctx.maps)) {
      try {
        ctx.echarts.registerMap(k, ctx.maps[k]);
      } catch {
        /* já registrado */
      }
    }
    mapsRegistered = true;
  }

  // Converte link interno ('/', '/listagem/', '/ies/USP/') para o irmão publicado.
  function appHref(h) {
    if (!h || h[0] !== '/' || h.slice(0, 2) === '//') return null;
    const clean = h.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
    const m = h.match(/[?#].*$/);
    const suffix = m ? m[0] : '';
    const page = (p) => (ctx.hrefMode === 'snapshot' ? './' + p + '.html' : '../' + p + '-app/app.html');
    if (!clean) return page('index') + suffix;
    const segs = clean.split('/');
    if (segs.length === 1) return page(segs[0]) + suffix;
    const dir = segs.slice(0, -1).join('/');
    const value = segs[segs.length - 1];
    const pname = ctx.paramPages && ctx.paramPages[dir];
    if (pname && ctx.hrefMode !== 'snapshot') {
      return '../' + dir.split('/').pop() + '-app/app.html?' + pname + '=' + encodeURIComponent(decodeURIComponent(value));
    }
    return null; // sem mapeamento: deixa o href original
  }

  function rewriteLinks(scope) {
    scope.querySelectorAll('a').forEach((an) => {
      const h = an.getAttribute('href') || '';
      const nh = appHref(h);
      if (nh) an.setAttribute('href', nh);
      else if (h[0] === '/' && h.slice(0, 2) !== '//') {
        // rota interna SEM alvo neste artefato (📦 → página parametrizada):
        // vira texto com dica — nunca um link para 404.
        const span = an.ownerDocument.createElement('span');
        span.textContent = an.textContent;
        span.title = 'disponível no app ☁ (página parametrizada)';
        span.className = 'link-off';
        an.replaceWith(span);
      }
    });
  }

  function chart(app, height) {
    const div = el('div', 'chart');
    if (height) div.style.height = height + 'px';
    app.appendChild(div);
    const c = ctx.echarts.init(div, dark ? 'dark' : null, { renderer: 'canvas' });
    charts.push(c);
    return c;
  }

  function renderItems(container, items) {
    (items || []).forEach((it) => {
      if (it.type === 'md') {
        const mdiv = el('div', 'md', ctx.md.render(ctx.renderInline(it.text)));
        rewriteLinks(mdiv);
        container.appendChild(mdiv);
        return;
      }
      if (it.type === 'dropdown') {
        const rows = ctx.dataFor(it.dataQuery) || [];
        if (rows.__error) {
          container.appendChild(el('div', 'err', htmlesc(rows.__error)));
          return;
        }
        const opts = (it.staticOptions || []).concat(rows.map((r) => ({ value: r[it.value], label: r[it.label] })));
        const wrap = el('div', 'dropdown');
        if (it.title) wrap.appendChild(el('label', null, htmlesc(it.title) + ': '));
        const sel = document.createElement('select');
        opts.forEach((o) => {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          sel.appendChild(op);
        });
        const cur = ctx.getInput(it.name);
        sel.value = cur != null ? cur : opts[0] && opts[0].value;
        sel.onchange = () => ctx.setInput(it.name, sel.value);
        wrap.appendChild(sel);
        container.appendChild(wrap);
        return;
      }
      if (it.type === 'component') renderComponent(container, it.name, it.attrs, it.children);
    });
  }

  function renderComponent(app, name, a, children) {
    const rows = ctx.dataFor(a.data) || [];
    if (rows && rows.__error) {
      app.appendChild(el('div', 'err', htmlesc(rows.__error)));
      return;
    }

    // Nested (F3 §5): query ÚNICA particionada; o container agrupa por chave-pai
    // e injeta cada partição no bloco-filho — partição no CLIENTE, sem N+1.
    if (name === 'Repeat') {
      const by = String(a.by || '').split(',').map((s) => s.trim()).filter(Boolean);
      const maxGroups = Number(a.maxGroups) || 50;
      const groups = [];
      const gIdx = {};
      (rows || []).forEach((r) => {
        const key = by.map((c) => String(r[c])).join(' · ');
        if (!(key in gIdx)) {
          gIdx[key] = groups.length;
          groups.push({ key, rows: [] });
        }
        groups[gIdx[key]].rows.push(r);
      });
      const wrap = el('div', 'repeat');
      app.appendChild(wrap); // no DOM antes dos filhos — echarts precisa medir
      if (groups.length > maxGroups) {
        wrap.appendChild(el('div', 'err', '⚠ ' + groups.length + ' grupos — mostrando os primeiros ' + maxGroups + ' (maxGroups).'));
      }
      const hidden = {};
      by.concat(['_rn']).forEach((c) => (hidden[c] = true));
      groups.slice(0, maxGroups).forEach((g) => {
        const box = el('div', 'repeat-group');
        wrap.appendChild(box);
        box.appendChild(el('div', 'repeat-title', htmlesc(g.key)));
        if ((a.childStyle || 'tabular') === 'tabular') {
          const cols = Object.keys(g.rows[0] || {}).filter((c) => !hidden[c]);
          let html = '<thead><tr>' + cols.map((c) => '<th>' + htmlesc(c) + '</th>').join('') + '</tr></thead><tbody>';
          g.rows.forEach((r) => {
            html += '<tr>' + cols.map((c) => '<td>' + htmlesc(r[c] == null ? '' : r[c]) + '</td>').join('') + '</tr>';
          });
          box.appendChild(el('table', 'grid', html + '</tbody>'));
        } else {
          chart(box, 220).setOption(
            buildChartOption({
              kind: a.childStyle === 'graph.line' ? 'line' : 'bar',
              rows: g.rows,
              attrs: { x: a.x, y: a.y },
              palette: ctx.theme && ctx.theme.chartPalette,
              dark: ctx.theme && ctx.theme.mode === 'dark',
            }),
            true
          );
        }
      });
      return;
    }

    // Inputs livres (TextInput/Slider/DateRange). No snapshot (ctx.staticInputs)
    // ficam travados no default — combos são pré-computados só para Dropdowns.
    if (name === 'TextInput' || name === 'Slider' || name === 'DateRange') {
      const wrap = el('div', 'dropdown');
      wrap.appendChild(el('label', null, htmlesc(a.title || a.name || '') + ': '));
      const frozen = !!ctx.staticInputs;
      const hint = 'Snapshot 📦 congela este input no valor padrão — use o ☁ Publish app para interação';
      if (name === 'TextInput') {
        const inp = document.createElement('input');
        inp.type = 'text';
        const cur = ctx.getInput(a.name);
        inp.value = cur != null ? String(cur) : String(a.defaultValue != null ? a.defaultValue : '');
        inp.onchange = () => ctx.setInput(a.name, inp.value);
        if (frozen) {
          inp.disabled = true;
          inp.title = hint;
        }
        wrap.appendChild(inp);
      } else if (name === 'Slider') {
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = String(a.min != null ? a.min : 0);
        inp.max = String(a.max != null ? a.max : 100);
        inp.step = String(a.step != null ? a.step : 1);
        const cur = ctx.getInput(a.name);
        inp.value = String(cur != null ? cur : a.defaultValue != null ? a.defaultValue : inp.min);
        const val = el('span', 'muted', htmlesc(inp.value));
        inp.oninput = () => (val.textContent = inp.value);
        inp.onchange = () => ctx.setInput(a.name, Number(inp.value));
        if (frozen) {
          inp.disabled = true;
          inp.title = hint;
        }
        wrap.appendChild(inp);
        wrap.appendChild(val);
      } else {
        const cur = ctx.getInput(a.name) || {};
        const mk = (key, fallback) => {
          const inp = document.createElement('input');
          inp.type = 'date';
          inp.value = cur[key] != null ? cur[key] : a[key] != null ? a[key] : fallback;
          inp.onchange = () => {
            const now = ctx.getInput(a.name) || {};
            ctx.setInput(a.name, { start: key === 'start' ? inp.value : now.start, end: key === 'end' ? inp.value : now.end });
          };
          if (frozen) {
            inp.disabled = true;
            inp.title = hint;
          }
          return inp;
        };
        wrap.appendChild(mk('start', '1900-01-01'));
        wrap.appendChild(el('span', null, ' — '));
        wrap.appendChild(mk('end', '2100-12-31'));
      }
      app.appendChild(wrap);
      return;
    }

    // Containers (filhos renderizados recursivamente)
    if (name === 'div' || name === 'Note' || name === 'Card' || name === 'Tab' || name === 'Tabs' || name === 'CardBody') {
      const box = el('div', name === 'Note' ? 'note' : name === 'Card' ? 'card' : 'ev-div');
      renderItems(box, children || []);
      app.appendChild(box);
      return;
    }
    if (name === 'Grid') {
      const g = el('div', 'ev-grid');
      g.style.display = 'grid';
      g.style.gap = (Number(a.gap) || 4) * 4 + 'px';
      g.style.gridTemplateColumns = 'repeat(' + (Number(a.cols) || 2) + ', 1fr)';
      renderItems(g, children || []);
      app.appendChild(g);
      return;
    }
    if (name === 'Details') {
      const d = el('details', 'ev-details');
      d.appendChild(el('summary', null, htmlesc(a.title || 'Detalhes')));
      const body = el('div', 'ev-details-body');
      renderItems(body, children || []);
      d.appendChild(body);
      app.appendChild(d);
      return;
    }
    if (name === 'CardTitle') {
      const t = el('div', 'card-title');
      renderItems(t, children || []);
      app.appendChild(t);
      return;
    }
    if (name === 'Value') {
      const col = a.column || (rows[0] ? Object.keys(rows[0])[0] : '');
      const vv = rows[0] ? rows[0][col] : undefined;
      app.appendChild(el('span', 'ev-value', typeof vv === 'number' ? fmt(vv, a.fmt) : htmlesc(vv == null ? '—' : vv)));
      return;
    }
    if (name === 'LinkButton') {
      // F5.1 (M34): rota interna passa por appHref (antes: _blank incondicional
      // para o href cru — 404 garantido nos publishes).
      const lb = el('a', 'linkbtn');
      const url = a.url || '#';
      lb.href = appHref(url) || url;
      if (/^https?:\/\//i.test(url)) {
        lb.target = '_blank';
        lb.rel = 'noreferrer';
      }
      const txt = (children || [])
        .filter((c) => c.type === 'md')
        .map((c) => c.text.trim())
        .join(' ');
      lb.textContent = ctx.renderInline(txt || a.url || '');
      app.appendChild(lb);
      return;
    }

    if (name === 'BigValue') {
      const v = rows[0] ? rows[0][a.value] : undefined;
      const box = el('div', 'bigvalue');
      box.appendChild(el('div', 'bv-title', htmlesc(a.title || a.value)));
      box.appendChild(el('div', 'bv-value', fmt(v, a.fmt)));
      app.appendChild(box);
      return;
    }

    if (name === 'DataTable') {
      renderDataTable(app, a, rows, children);
      return;
    }

    if (name === 'BarChart' || name === 'LineChart' || name === 'BubbleChart') {
      const kind = name === 'BarChart' ? 'bar' : name === 'LineChart' ? 'line' : 'scatter';
      const attrs = Object.assign({}, a);
      if (typeof attrs.y === 'string' && attrs.y.indexOf('[') === 0) {
        try {
          attrs.y = JSON.parse(attrs.y.replace(/'/g, '"'));
        } catch {
          /* mantém string */
        }
      }
      const height = attrs.swapXY === 'true' ? Math.max(320, 40 + rows.length * 26) : undefined;
      chart(app, height).setOption(buildChartOption({ kind, rows, attrs, palette, dark }), true);
      return;
    }

    if (name === 'ConnectionMap') {
      ensureMaps();
      chart(app, a.height ? Number(a.height) : 460).setOption(
        buildMapOption({ rows: rows || [], attrs: a, palette, dark }),
        true
      );
      return;
    }
    if (name === 'AreaMap') {
      renderAreaMap(app, a, rows);
      return;
    }

    if (children && children.length) {
      const anon = el('div', null);
      renderItems(anon, children);
      app.appendChild(anon);
      return;
    }
    app.appendChild(el('div', 'muted', 'Componente: ' + htmlesc(name)));
  }

  function renderDataTable(app, a, rows, children) {
    if (!rows.length) {
      app.appendChild(el('div', 'muted', 'Sem dados.'));
      return;
    }
    const linkCol = a.link;
    let defs = (children || [])
      .filter((c) => c.type === 'component' && c.name === 'Column')
      .map((c) => c.attrs);
    if (!defs.length) defs = Object.keys(rows[0]).map((c) => ({ id: c }));
    defs = defs.filter((c) => c.id !== linkCol);
    const numCols = {};
    defs.forEach((c) => {
      if (typeof rows[0][c.id] === 'number') numCols[c.id] = 1;
    });
    const scaleMax = {};
    defs.forEach((c) => {
      if (c.contentType === 'colorscale') {
        let m = 1e-9;
        rows.forEach((r) => {
          const n = Number(r[c.id]) || 0;
          if (n > m) m = n;
        });
        scaleMax[c.id] = m;
      }
    });
    const lim = a.rows ? Number(a.rows) : 50;
    let shown = rows;

    const tbl = (filterText) => {
      const data = filterText
        ? rows.filter((r) => {
            const t = filterText.toLowerCase();
            return Object.values(r).some((v) => String(v == null ? '' : v).toLowerCase().indexOf(t) >= 0);
          })
        : rows;
      shown = data;
      let html =
        '<table class="grid"><thead><tr>' +
        defs
          .map((c) => {
            const cls = c.align === 'center' ? 'ctr' : c.align === 'right' || numCols[c.id] ? 'num' : '';
            return '<th' + (cls ? ' class="' + cls + '"' : '') + '>' + htmlesc(c.title || c.id) + '</th>';
          })
          .join('') +
        '</tr></thead><tbody>';
      data.slice(0, lim).forEach((r) => {
        let href = linkCol ? r[linkCol] : null;
        if (href) {
          const rh = appHref(String(href));
          // rota interna sem alvo NESTE artefato (📦 → página parametrizada):
          // linha fica sem link — nunca um href para 404.
          if (rh) href = rh;
          else if (String(href)[0] === '/' && String(href).slice(0, 2) !== '//') href = null;
        }
        html +=
          '<tr>' +
          defs
            .map((c, ci) => {
              const v = r[c.id];
              const disp = typeof v === 'number' || c.fmt ? fmt(v, c.fmt) : v == null ? '' : htmlesc(v);
              let cls = c.align === 'center' ? 'ctr' : c.align === 'right' || numCols[c.id] ? 'num' : '';
              if (c.wrap === 'true') cls += ' wrap';
              let style = '';
              if (c.contentType === 'colorscale' && typeof v === 'number') {
                const t = Math.max(0, Math.min(1, v / scaleMax[c.id]));
                style = ' style="background:rgba(35,106,164,' + (0.08 + 0.42 * t).toFixed(3) + ')"';
              }
              const td = '<td' + (cls ? ' class="' + cls + '"' : '') + style + '>';
              if (c.contentType === 'link' && v) {
                const lbl = c.linkLabel && r[c.linkLabel] !== undefined ? r[c.linkLabel] : c.linkLabel || v;
                return (
                  td +
                  '<a href="' +
                  htmlesc(v) +
                  '"' +
                  (c.openInNewTab === 'true' ? ' target="_blank" rel="noreferrer"' : '') +
                  '>' +
                  htmlesc(lbl) +
                  '</a></td>'
                );
              }
              if (href && ci === 0) return td + '<a href="' + htmlesc(href) + '">' + disp + '</a></td>';
              return td + disp + '</td>';
            })
            .join('') +
          '</tr>';
      });
      return html + '</tbody></table>';
    };

    const tdiv = el('div', null, tbl(''));
    if (a.search === 'true' || a.downloadable === 'true') {
      const bar = el('div', 'dt-toolbar');
      if (a.search === 'true') {
        const inp = document.createElement('input');
        inp.placeholder = 'buscar…';
        inp.oninput = () => {
          tdiv.innerHTML = tbl(inp.value);
        };
        bar.appendChild(inp);
      }
      if (a.downloadable === 'true') {
        const bt = el('button', null, '⬇ CSV');
        bt.onclick = () => {
          const lines = [defs.map((c) => c.title || c.id)]
            .concat(shown.map((r) => defs.map((c) => r[c.id])))
            .map((cells) => cells.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';'));
          const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
          const aa = document.createElement('a');
          aa.href = URL.createObjectURL(blob);
          aa.download = (a.data || 'dados') + '.csv';
          aa.click();
          URL.revokeObjectURL(aa.href);
        };
        bar.appendChild(bt);
      }
      app.appendChild(bar);
    }
    app.appendChild(tdiv);
  }

  function renderAreaMap(app, a, rows) {
    ensureMaps();
    if (!ctx.maps || !ctx.maps.brazil) {
      app.appendChild(el('div', 'muted', 'Mapa indisponível.'));
      return;
    }
    chart(app, a.height ? Number(a.height) : 480).setOption(
      buildAreaMapOption({ rows: rows || [], attrs: a, palette, dark, mapName: 'brazil' }),
      true
    );
  }

  window.addEventListener('resize', () => charts.forEach((c) => c.resize()));

  return {
    appHref,
    /** Re-render completo: descarta gráficos anteriores e redesenha os itens. */
    render(container, items) {
      charts.forEach((c) => {
        try {
          c.dispose();
        } catch {
          /* já destruído */
        }
      });
      charts.length = 0;
      container.innerHTML = '';
      renderItems(container, items);
    },
  };
}
