// Parser ÚNICO da sintaxe Markdown+SQL do Studio Console (dialeto Evidence.dev).
// Consumido por: preview React (web), notebook (web), geradores de publish (Node).
// Qualquer mudança de sintaxe acontece SÓ aqui.
//
// Suporta:
//  - frontmatter YAML mínimo (title, description, queries: [- nome: arquivo.sql])
//  - blocos ```sql nome ... ```
//  - componentes self-closing <Comp attr=v />, inclusive multi-linha
//  - componentes pareados com filhos: <DataTable><Column/></DataTable>,
//    <Note>texto</Note>, <Tabs><Tab>…</Tab></Tabs>, <Grid><Card>…</Card></Grid>
//    (filhos são parseados recursivamente como blocos)

/** Extrai atributos de uma tag: name=valor, name="valor", name={expr}. */
export function parseAttrs(s) {
  const attrs = {};
  const re = /(\w+)=(\{[^}]*\}|"[^"]*"|'[^']*'|\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    let v = m[2];
    if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
    else if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    attrs[m[1]] = v;
  }
  return attrs;
}

/**
 * Frontmatter YAML mínimo no topo do arquivo:
 *   ---
 *   title: Texto
 *   queries:
 *     - nome: arquivo.sql
 *   ---
 * Retorna { meta, body, raw }. meta=null se não há frontmatter.
 */
export function parseFrontmatter(src) {
  const s = String(src || '');
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { meta: null, body: s, raw: '' };
  const meta = { queries: [] };
  let inQueries = false;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      inQueries = kv[1] === 'queries' && !kv[2].trim();
      if (!inQueries) meta[kv[1]] = kv[2].trim();
      continue;
    }
    const item = line.match(/^\s+-\s+([\w.\-]+)\s*:\s*(\S+)/);
    if (item && inQueries) meta.queries.push({ name: item[1], file: item[2] });
  }
  return { meta, body: s.slice(m[0].length), raw: m[0] };
}

/** Remove comentários HTML <!-- ... --> (apenas para RENDER; o fonte os preserva). */
export function stripHtmlComments(text) {
  return String(text || '').replace(/<!--[\s\S]*?-->/g, '');
}

// Varre a tag de abertura a partir de '<Nome'. Respeita aspas e chaves {…} nos
// atributos. Retorna { name, attrsStr, selfClosed, headEnd } ou null se incompleta.
// Além de componentes Capitalizados, aceita <div> minúsculo (agrupador de layout
// do Evidence dentro de <Grid> etc.).
function scanTag(text) {
  const m = text.match(/^<([A-Z]\w*|div)\b/);
  if (!m) return null;
  let pos = m[0].length;
  let inQ = null;
  for (; pos < text.length; pos++) {
    const ch = text[pos];
    if (inQ) {
      if (ch === inQ) inQ = null;
      continue;
    }
    if (ch === '"' || ch === "'") inQ = ch;
    else if (ch === '{') {
      let d = 1;
      pos++;
      while (pos < text.length && d > 0) {
        if (text[pos] === '{') d++;
        else if (text[pos] === '}') d--;
        pos++;
      }
      pos--;
    } else if (ch === '>') break;
  }
  if (pos >= text.length) return null;
  const selfClosed = text[pos - 1] === '/';
  const attrsStr = text.slice(m[0].length, selfClosed ? pos - 1 : pos);
  return { name: m[1], attrsStr, selfClosed, headEnd: pos + 1 };
}

// Encontra o fechamento </Nome> correspondente (com aninhamento do mesmo nome).
// Retorna { inner, end } ou null se não fecha.
function scanClose(text, name, from) {
  let depth = 1;
  let k = from;
  const closeTag = '</' + name + '>';
  const openRe = new RegExp('<' + name + '(?=[\\s/>])', 'g');
  while (depth > 0) {
    const nextClose = text.indexOf(closeTag, k);
    if (nextClose === -1) return null;
    openRe.lastIndex = k;
    const om = openRe.exec(text);
    if (om && om.index < nextClose) {
      const t = scanTag(text.slice(om.index));
      k = om.index + (t ? t.headEnd : 1);
      if (t && !t.selfClosed) depth++;
    } else {
      depth--;
      k = nextClose + closeTag.length;
      if (depth === 0) return { inner: text.slice(from, nextClose), end: k };
    }
  }
  return null;
}

/**
 * Quebra o .md em blocos ordenados:
 *  - { type:'frontmatter', meta, raw }              — só no topo, se existir
 *  - { type:'md', text }                            — prosa Markdown
 *  - { type:'sql', name, sql }                      — bloco ```sql nome ... ```
 *  - { type:'component', name, attrs, raw,          — tag <Comp/> ou <Comp>…</Comp>
 *      children?, inner? }                            children = blocos do conteúdo interno
 */
export function parseBlocks(src, opts = {}) {
  const withFrontmatter = opts.frontmatter !== false;
  let body = String(src || '');
  const blocks = [];
  if (withFrontmatter) {
    const fm = parseFrontmatter(body);
    if (fm.meta) {
      blocks.push({ type: 'frontmatter', meta: fm.meta, raw: fm.raw.replace(/\r?\n$/, '') });
      body = fm.body;
    }
  }
  const lines = body.split(/\r?\n/);
  let buf = [];
  const flush = () => {
    if (buf.join('').trim()) blocks.push({ type: 'md', text: buf.join('\n') });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const sqlStart = lines[i].match(/^```sql\s+([A-Za-z_]\w*)\s*$/);
    if (sqlStart) {
      flush();
      const sqlBody = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) sqlBody.push(lines[i++]);
      blocks.push({ type: 'sql', name: sqlStart[1], sql: sqlBody.join('\n') });
      continue;
    }
    const trimmed = lines[i].trim();
    if (/^<([A-Z]\w*|div\b)/.test(trimmed)) {
      // Junta o restante do arquivo e tenta consumir um componente completo.
      const offset = lines[i].indexOf('<');
      const rest = lines[i].slice(offset) + (i + 1 < lines.length ? '\n' + lines.slice(i + 1).join('\n') : '');
      const tag = scanTag(rest);
      if (tag) {
        let raw, children, inner;
        let consumedEnd = -1;
        if (tag.selfClosed) {
          consumedEnd = tag.headEnd;
        } else {
          const close = scanClose(rest, tag.name, tag.headEnd);
          if (close) {
            inner = close.inner;
            children = parseBlocks(inner, { frontmatter: false });
            consumedEnd = close.end;
          }
        }
        if (consumedEnd > 0) {
          flush();
          raw = rest.slice(0, consumedEnd);
          blocks.push({
            type: 'component',
            name: tag.name,
            attrs: parseAttrs(tag.attrsStr.replace(/\n/g, ' ')),
            raw,
            ...(children ? { children, inner } : {}),
          });
          i += (raw.match(/\n/g) || []).length;
          continue;
        }
      }
    }
    buf.push(lines[i]);
  }
  flush();
  return blocks;
}
