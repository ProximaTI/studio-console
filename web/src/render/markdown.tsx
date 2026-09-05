import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import MarkdownIt from 'markdown-it';
import { runQuery } from '../api';
import { applyTemplates, renderInline } from './interpolate';
import { resolveAttrs } from '../../../shared/templating.js';
import { parseBlocks, stripHtmlComments } from '../../../shared/parser.js';
import BigValue from './components/BigValue';
import BarChart from './components/BarChart';
import LineChart from './components/LineChart';
import BubbleChart from './components/BubbleChart';
import DataTable from './components/DataTable';
import Dropdown from './components/Dropdown';
import ConnectionMap from './components/ConnectionMap';
import CollaborationGraph from './components/CollaborationGraph';
import AreaMap from './components/AreaMap';
import TextInput from './components/TextInput';
import Slider from './components/Slider';
import DateRange from './components/DateRange';
import Repeat from './components/Repeat';
import { Note, LinkButton, Grid, Card, CardTitle, CardBody, Tabs, Tab, Details, Div, Value } from './components/Layout';

const mdIt = new MarkdownIt({ html: false, linkify: true, breaks: false });
const COMPONENTS: Record<string, any> = {
  BigValue,
  BarChart,
  LineChart,
  BubbleChart,
  DataTable,
  Dropdown,
  ConnectionMap,
  CollaborationGraph,
  Note,
  LinkButton,
  Grid,
  Card,
  CardTitle,
  CardBody,
  Tabs,
  Tab,
  Details,
  Value,
  AreaMap,
  TextInput,
  Slider,
  DateRange,
  Repeat,
  div: Div,
};
// Tags que são apenas estruturais (filhos consumidos pelo componente pai).
const CHILD_ONLY = new Set(['Column', 'DropdownOption']);

type Ctx = {
  dataMap: Record<string, any[]>;
  errors: Record<string, string>;
  inputs: Record<string, any>;
  setInput: (n: string, v: any) => void;
  settings: any;
  params: Record<string, any>;
  onLink?: (href: string) => void;
};
export const PreviewCtx = createContext<Ctx>(null as any);
export const usePreview = () => useContext(PreviewCtx);

/** Renderiza uma lista de blocos do parser (usado no topo e dentro de containers). */
export function Blocks({ blocks }: { blocks: any[] }) {
  const { dataMap, params, inputs, onLink } = usePreview();
  // F5.1 (M34): links markdown com rota interna (/pagina/, /dir/valor/) navegam
  // via onLink — antes o <a> cru quebrava a SPA; http(s) segue externo.
  const mdClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || !onLink) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith('//')) {
      e.preventDefault();
      onLink(href);
    }
  };
  return (
    <>
      {blocks.map((b: any, i: number) => {
        if (b.type === 'frontmatter' || b.type === 'sql') return null;
        if (b.type === 'md') {
          const text = stripHtmlComments(b.text);
          if (!text.trim()) return null;
          const html = mdIt.render(renderInline(text, dataMap, params, inputs));
          return <div key={i} className="md" onClick={mdClick} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        if (CHILD_ONLY.has(b.name)) return null;
        const C = COMPONENTS[b.name];
        if (!C)
          return (
            <div key={i} className="error">
              Componente desconhecido: {b.name}
            </div>
          );
        const attrs = resolveAttrs(b.attrs, { dataMap, params, inputs });
        return <C key={i} {...attrs} __children={b.children} __inner={b.inner} />;
      })}
    </>
  );
}

export default function PreviewRenderer({
  source,
  settings,
  params = {},
  onLink,
  loadQuery,
  project,
}: {
  source: string;
  settings: any;
  params?: Record<string, any>;
  onLink?: (href: string) => void;
  /** Carrega um .sql externo do frontmatter (queries/<arquivo> do projeto). */
  loadQuery?: (file: string) => Promise<{ content?: string; error?: string }>;
  /** Projeto dono da página — as queries rodam no schema dele. */
  project?: string;
}) {
  const blocks = useMemo(() => parseBlocks(source), [source]);
  const meta = (blocks[0]?.type === 'frontmatter' ? blocks[0].meta : null) as any;
  const [inputs, setInputs] = useState<Record<string, any>>({});
  const [dataMap, setDataMap] = useState<Record<string, any[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [extQueries, setExtQueries] = useState<Record<string, { sql?: string; error?: string }>>({});
  // DateRange guarda {start, end} cru; os demais embrulham em {value}.
  const setInput = (n: string, v: any) =>
    setInputs((p) => ({ ...p, [n]: v && typeof v === 'object' && ('start' in v || 'end' in v) ? v : { value: v } }));

  // Coleta queries: blocos ```sql inline + .sql externos do frontmatter (Evidence).
  const inlineQueries = useMemo(() => collectSql(blocks), [blocks]);
  const fmKey = (meta?.queries || []).map((q: any) => q.name + ':' + q.file).join('|');

  useEffect(() => {
    let cancelled = false;
    const list = meta?.queries || [];
    if (!list.length || !loadQuery) {
      setExtQueries({});
      return;
    }
    (async () => {
      const out: Record<string, { sql?: string; error?: string }> = {};
      for (const q of list) {
        const r = await loadQuery(q.file);
        out[q.name] = r.error ? { error: `${q.file}: ${r.error}` } : { sql: r.content || '' };
      }
      if (!cancelled) setExtQueries(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmKey, loadQuery]);

  const queries = useMemo(() => {
    const all: { name: string; sql: string }[] = [];
    const errs: Record<string, string> = {};
    for (const [name, q] of Object.entries(extQueries)) {
      if (q.error) errs[name] = q.error;
      else if (q.sql !== undefined) all.push({ name, sql: q.sql });
    }
    // Bloco inline com o mesmo nome sobrescreve o externo (protótipo rápido).
    for (const q of inlineQueries) {
      const i = all.findIndex((x) => x.name === q.name);
      if (i >= 0) all[i] = q;
      else all.push(q);
    }
    return { all, errs };
  }, [inlineQueries, extQueries]);

  const qKey = queries.all.map((q) => q.name + ':' + q.sql).join('|');
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    // Debounce: evita re-executar todas as queries a cada tecla digitada no editor.
    const t = setTimeout(async () => {
      const dm: Record<string, any[]> = {};
      const er: Record<string, string> = { ...queries.errs };
      for (const q of queries.all) {
        const r = await runQuery(applyTemplates(q.sql, inputs, params), project);
        if (r.error) er[q.name] = r.error;
        else dm[q.name] = r.rows || [];
      }
      if (!cancelled) {
        setDataMap(dm);
        setErrors(er);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey, inputs, paramsKey]);

  return (
    <PreviewCtx.Provider value={{ dataMap, errors, inputs, setInput, settings, params, onLink }}>
      <div className="preview">
        <Blocks blocks={blocks} />
      </div>
    </PreviewCtx.Provider>
  );
}

// Blocos sql em qualquer nível (inclusive dentro de containers como <Tab>).
function collectSql(blocks: any[]): { name: string; sql: string }[] {
  const out: { name: string; sql: string }[] = [];
  for (const b of blocks) {
    if (b.type === 'sql') out.push({ name: b.name, sql: b.sql });
    if (b.children) out.push(...collectSql(b.children));
  }
  return out;
}
