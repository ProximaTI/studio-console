import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { sql as sqlLang } from '@codemirror/lang-sql';
import PreviewRenderer from '../render/markdown';
import Notebook from '../notebook/Notebook';
import { paramNameFromFile, collectParamRefs, collectInputNames, applyTemplates } from '../render/interpolate';
import { lintEvidenceCompat, frontmatterQueries } from '../../../shared/evidenceLint.js';
import { jget, jput, jpost, jdel, runQuery } from '../api';
import { alertDialog, confirmDialog, promptDialog, formDialog } from '../components/dialogs';
import ResultsGrid from '../components/ResultsGrid';

type Mode = 'notebook' | 'split' | 'source';

export default function ProjectEditor() {
  const { project } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [content, setContent] = useState('');
  const [settings, setSettings] = useState<any>({});
  const [saved, setSaved] = useState(true);
  // Modo persiste entre reloads/HMR (antes sempre voltava para "notebook").
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem('studio.mode') as Mode) || 'notebook');
  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem('studio.mode', m);
  };
  const [paramValues, setParamValues] = useState<string[]>([]);
  const [paramValue, setParamValue] = useState('');
  // Aba Queries: .sql do diretório queries/ do projeto (frontmatter Evidence).
  const [queryFiles, setQueryFiles] = useState<string[]>([]);
  const [activeQuery, setActiveQuery] = useState(''); // se setado, editamos um .sql
  // Runner da query ativa: limite de linhas + valores de teste p/ placeholders.
  const [qLimit, setQLimit] = useState(20);
  const [qVals, setQVals] = useState<Record<string, string>>({});
  const [qRes, setQRes] = useState<any>(null);
  const [qRunning, setQRunning] = useState(false);
  const activeRef = useRef('');
  activeRef.current = active;
  const activeQueryRef = useRef('');
  activeQueryRef.current = activeQuery;

  const paramName = paramNameFromFile(active);
  const params = paramName ? { [paramName]: paramValue } : {};
  const paramRefs = paramName ? Array.from(new Set([paramName, ...collectParamRefs(content)])) : collectParamRefs(content);

  // Carrega .sql externos do frontmatter (queries: - nome: arquivo.sql).
  const loadQuery = useCallback(
    (file: string) => jget('/projects/' + project + '/query-file?path=' + encodeURIComponent(file)),
    [project]
  );

  const open = useCallback(
    (f: string, presetValue?: string) => {
      jget('/projects/' + project + '/file?path=' + encodeURIComponent(f)).then((d) => {
        setActiveQuery('');
        setActive(f);
        setContent(d.content || '');
        setSaved(true);
        localStorage.setItem('studio.file.' + project, f);
        if (presetValue !== undefined) setParamValue(presetValue);
      });
    },
    [project]
  );

  // Abre um .sql de queries/ no editor (modo SQL, sem preview).
  const openQuery = useCallback(
    (f: string) => {
      jget('/projects/' + project + '/query-file?path=' + encodeURIComponent(f)).then((d) => {
        setActive('');
        setActiveQuery(f);
        setContent(d.content || '');
        setSaved(true);
        setQRes(null);
      });
    },
    [project]
  );

  // Placeholders usados pela query ativa (viram campos de teste no runner).
  const qParamNames = activeQuery ? collectParamRefs(content) : [];
  const qInputNames = activeQuery ? collectInputNames(content) : [];

  // Roda o .sql ativo com valores de teste e limite (select * from (...) t limit N).
  const runQueryFile = useCallback(async () => {
    const params: Record<string, string> = {};
    for (const p of qParamNames) params[p] = qVals['p:' + p] ?? '';
    const inputs: Record<string, any> = {};
    for (const n of qInputNames) inputs[n] = { value: qVals['i:' + n] ?? '' };
    const sql = applyTemplates(content, inputs, params).replace(/;\s*$/, '');
    const lim = Math.max(1, Number(qLimit) || 20);
    setQRunning(true);
    const r = await runQuery(`select * from (\n${sql}\n) t limit ${lim}`, project);
    setQRes(r);
    setQRunning(false);
  }, [content, qLimit, qVals, qParamNames.join(','), qInputNames.join(',')]);

  useEffect(() => {
    jget('/settings').then(setSettings);
  }, []);

  // Linter de compatibilidade Evidence: página + .sql do frontmatter (debounced).
  // A console prototipa; o deploy é Evidence on-premise — avisa aqui o que
  // quebraria ou renderizaria diferente lá.
  const [lint, setLint] = useState<any[]>([]);
  const [lintOpen, setLintOpen] = useState(false);
  useEffect(() => {
    if (!active || !active.endsWith('.md')) {
      setLint([]);
      return;
    }
    const forFile = active;
    const t = setTimeout(async () => {
      const queries: { name: string; sql: string }[] = [];
      for (const q of frontmatterQueries(content)) {
        const d = await loadQuery(q.file);
        if (d?.content) queries.push({ name: q.file, sql: d.content });
      }
      if (activeRef.current !== forFile) return; // trocou de arquivo durante os fetches
      setLint(lintEvidenceCompat(content, { queries }));
    }, 500);
    return () => clearTimeout(t);
  }, [content, active, loadQuery]);

  useEffect(() => {
    setActive('');
    setActiveQuery('');
    jget('/projects/' + project + '/files').then((d) => {
      const fs: string[] = d.files || [];
      setFiles(fs);
      // Reabre o último arquivo usado neste projeto, se ainda existir.
      const last = localStorage.getItem('studio.file.' + project);
      if (fs.length)
        open(last && fs.includes(last) ? last : fs.includes('home.md') ? 'home.md' : fs.includes('index.md') ? 'index.md' : fs[0]);
    });
    jget('/projects/' + project + '/query-files').then((d) => setQueryFiles(d.files || []));
  }, [project, open]);

  // Para páginas parametrizadas: descobre os valores possíveis pela convenção Evidence
  // (1ª query cuja coluna tem o nome do parâmetro -> select distinct dessa coluna).
  useEffect(() => {
    if (!paramName) {
      setParamValues([]);
      return;
    }
    const qBlocks = [...content.matchAll(/```sql\s+\w+\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    let cancelled = false;
    // Debounce: o probe rodava a cada tecla digitada.
    const t = setTimeout(async () => {
      for (const sql of qBlocks) {
        // tenta rodar a query e ver se tem a coluna do parâmetro
        const probe = `select distinct "${paramName}" as v from (${sql.replace(/;\s*$/, '')}) t order by 1`;
        const r = await runQuery(probe, project);
        if (cancelled) return;
        if (!r.error && r.rows) {
          const vals = r.rows.map((x: any) => String(x.v));
          setParamValues(vals);
          setParamValue((cur) => (cur && vals.includes(cur) ? cur : vals[0] || ''));
          return;
        }
      }
      setParamValues([]);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, content, paramName]);

  const save = useCallback(async () => {
    if (activeQueryRef.current) {
      await jput('/projects/' + project + '/query-file', { path: activeQueryRef.current, content });
      setSaved(true);
      return;
    }
    if (!activeRef.current) return;
    const r = await jput('/projects/' + project + '/file', { path: activeRef.current, content });
    if (r?.error) {
      // transação página↔spec (F6): a gravação foi desfeita no server
      alertDialog(r.error, 'Salvar');
      return;
    }
    setSaved(true);
  }, [project, content]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
      // Ctrl+Enter roda o .sql ativo da aba Queries.
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && activeQueryRef.current) {
        e.preventDefault();
        runQueryFile();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save, runQueryFile]);

  function update(v: string) {
    setContent(v);
    setSaved(false);
  }

  // Navegação a partir de links de DataTable/Card/LinkButton.
  // Aceita rotas estilo Evidence (/instituicao/I123/, /starter-analyses/x/) e o
  // formato legado da console (?param=valor#arquivo).
  function onLink(href: string) {
    // 1) Rota Evidence: caminho absoluto dentro do projeto.
    if (href.startsWith('/') || href.startsWith('./')) {
      const clean = decodeURIComponent(
        href.replace(/^\.?\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
      );
      if (!clean) {
        if (files.includes('index.md')) return open('index.md');
      } else {
        if (files.includes(clean + '/index.md')) return open(clean + '/index.md');
        if (files.includes(clean + '.md')) return open(clean + '.md');
        if (files.includes(clean)) return open(clean);
        // último segmento é VALOR de uma página parametrizada do diretório pai:
        // /instituicao/I123/ -> instituicao/[institution_id].md com valor I123
        const i = clean.lastIndexOf('/');
        const dir = i > 0 ? clean.slice(0, i) : '';
        const val = i > 0 ? clean.slice(i + 1) : clean;
        const target = files.find(
          (f) => (dir ? f.startsWith(dir + '/') : !f.includes('/')) && paramNameFromFile(f)
        );
        if (target) return open(target, val);
      }
    }
    // 2) Formato legado: ?param=valor#arquivo
    try {
      const u = new URL(href, 'http://x/');
      const q = u.searchParams;
      let targetFile = decodeURIComponent((u.hash || '').replace(/^#/, ''));
      let pName = '';
      let pVal = '';
      q.forEach((val, key) => {
        pName = key;
        pVal = val;
      });
      if (!targetFile && pName) {
        // procura [pName].md (possivelmente em subpasta) na lista de arquivos
        targetFile = files.find((f) => paramNameFromFile(f) === pName) || '';
      }
      if (targetFile) open(targetFile, pVal);
      else if (pName) setParamValue(pVal);
    } catch {
      /* href não navegável */
    }
  }

  async function newQueryFile() {
    const n = await promptDialog('Nome do arquivo .sql (vai para queries/ do projeto):', {
      title: 'Nova query',
      placeholder: 'minha_query.sql',
    });
    if (!n) return;
    const name = (n.endsWith('.sql') ? n : n + '.sql').replace(/[^a-zA-Z0-9_.-]/g, '_');
    await jput('/projects/' + project + '/query-file', { path: name, content: '-- ' + name + '\nselect 1\n' });
    const d = await jget('/projects/' + project + '/query-files');
    setQueryFiles(d.files || []);
    openQuery(name);
  }

  async function newFile() {
    const n = await promptDialog('Nome do arquivo (.md). Use barra para subpasta, ex.: relatorios/jan.md', {
      title: 'Novo arquivo',
      placeholder: 'relatorios/jan.md',
    });
    if (!n) return;
    const r = await jpost('/projects/' + project + '/file', { path: n });
    const d = await jget('/projects/' + project + '/files');
    setFiles(d.files || []);
    open(r.file);
  }

  async function delFile() {
    if (!active) return;
    if (!(await confirmDialog(`Excluir "${active}"? Esta ação não pode ser desfeita.`, { confirmLabel: 'Excluir', danger: true }))) return;
    await jdel('/projects/' + project + '/file?path=' + encodeURIComponent(active));
    const d = await jget('/projects/' + project + '/files');
    const fs: string[] = d.files || [];
    setFiles(fs);
    if (fs.length) open(fs[0]);
    else {
      setActive('');
      setContent('');
    }
  }

  // Assistente: cria <param>/[<param>].md (template) + <param>/index.md (índice navegável).
  async function newParamPages() {
    const sources = (await jget('/projects/' + project + '/sources')).sources || [];
    if (!sources.length) {
      await alertDialog('Nenhuma fonte de dados — suba um arquivo em Connectors primeiro.');
      return;
    }
    const step1 = await formDialog({
      title: 'Nova página por…',
      message: 'Cria <param>/[<param>].md (template) + <param>/index.md (índice navegável).',
      confirmLabel: 'Avançar',
      fields: [
        { name: 'param', label: 'Nome do parâmetro', placeholder: 'ex.: prof, uf, sigla' },
        { name: 'source', label: 'Fonte (tabela) com os valores', type: 'select', options: sources.map((s: any) => ({ value: s.name })) },
      ],
    });
    if (!step1) return;
    const paramN = step1.param.trim().replace(/[^a-zA-Z0-9_]/g, '');
    const source = step1.source;
    if (!paramN || !source) return;
    const cols = (sources.find((s: any) => s.name === source)?.columns || []).map((c: any) => c.name);
    const step2 = await formDialog({
      title: `Nova página por ${paramN}`,
      confirmLabel: 'Criar páginas',
      fields: [
        {
          name: 'col',
          label: `Coluna de ${source} que define os valores`,
          type: 'select',
          options: cols.map((c: string) => ({ value: c })),
          hint: `Vira o parâmetro "${paramN}" (query-convenção Evidence)`,
        },
      ],
    });
    if (!step2) return;
    const col = step2.col;
    if (!col) return;

    const folder = paramN;
    const tpl = `# Perfil: {params.${paramN}}

\`\`\`sql ${paramN}
-- query-convenção: a coluna "${paramN}" define os valores de página
select distinct ${col} as ${paramN} from ${source} order by 1
\`\`\`

\`\`\`sql resumo
select count(*) as n_registros
from ${source}
where ${col} = '\${params.${paramN}}'
\`\`\`

Total de **{resumo[0].n_registros}** registros para {params.${paramN}}.

\`\`\`sql detalhe
select * from ${source}
where ${col} = '\${params.${paramN}}'
\`\`\`

<DataTable data={detalhe}/>
`;

    // Rota estilo Evidence /pasta/valor/ — funciona no editor E nos publishes
    // (o formato legado ?p=…#arquivo só funcionava no editor).
    const idx = `# Índice por ${paramN}

\`\`\`sql lista
select ${col} as ${paramN},
       count(*) as n_registros,
       '/${folder}/' || cast(${col} as varchar) || '/' as link
from ${source}
group by 1
order by 2 desc
\`\`\`

<DataTable data={lista} link=link/>
`;

    // PUT cria as subpastas e grava o conteúdo de uma vez.
    await jput('/projects/' + project + '/file', { path: `${folder}/[${paramN}].md`, content: tpl });
    await jput('/projects/' + project + '/file', { path: `${folder}/index.md`, content: idx });
    const d = await jget('/projects/' + project + '/files');
    setFiles(d.files || []);
    open(`${folder}/index.md`);
  }

  const [publishing, setPublishing] = useState(false);
  async function publish() {
    if (!active) return;
    setPublishing(true);
    await save();
    let r = await jpost('/projects/' + project + '/publish', { path: active });
    // Política F3 §6: dimensão internal recusada no público — oferece o interno.
    if (r.error && String(r.error).includes('PÚBLICO recusado')) {
      const interno = await confirmDialog(r.error + '\n\nPublicar como INTERNO (painel com auth)?', {
        title: '🔒 Política de publish',
        confirmLabel: 'Publicar interno',
      });
      if (interno) r = await jpost('/projects/' + project + '/publish', { path: active, visibility: 'internal' });
    }
    setPublishing(false);
    if (r.error) {
      alertDialog('Erro ao publicar: ' + r.error);
      return;
    }
    const url = '/api/projects/' + project + '/published/' + r.file;
    const kb = Math.round((r.bytes || 0) / 1024);
    if (await confirmDialog(`App publicado (${kb} KB), offline e interativo.\n\nAbrir agora em nova aba?`, { title: '📦 Publish', confirmLabel: 'Abrir' })) {
      window.open(url, '_blank');
    }
  }

  const [publishingApp, setPublishingApp] = useState(false);
  async function publishApp() {
    if (!active) return;
    const v = await formDialog({
      title: '☁ Publish app',
      message: 'Parquet + DuckDB-WASM. Atualização mensal = trocar o .parquet.',
      confirmLabel: 'Publicar',
      fields: [
        { name: 'baseUrl', label: 'Base URL do object storage (opcional)', placeholder: 'https://meu-bucket.r2.dev/studio', hint: 'vazio = pasta ./data local' },
        {
          name: 'visibility',
          label: 'Visibilidade',
          type: 'select',
          options: [
            { value: 'public', label: 'Público (recusa dimensões internas/pii)' },
            { value: 'internal', label: 'Interno (painel com auth — libera dimensões internas)' },
          ],
        },
      ],
    });
    if (!v) return;
    const baseUrl = v.baseUrl || '';
    setPublishingApp(true);
    await save();
    const r = await jpost('/projects/' + project + '/publish-app', { path: active, baseUrl, visibility: v.visibility });
    setPublishingApp(false);
    if (r.error) {
      alertDialog('Erro ao publicar app: ' + r.error);
      return;
    }
    const onde = r.dataBase && r.dataBase.startsWith('http') ? `URL remota (${r.dataBase})` : 'pasta ./data local';
    const extra = r.paramName ? `\nPágina parametrizada por "${r.paramName}" — use ?${r.paramName}=valor na URL.` : '';
    const msg =
      `App com Universal SQL gerado.\n\n` +
      `Fontes (Parquet): ${(r.sources || []).join(', ') || '—'}\n` +
      `Dados lidos de: ${onde}${extra}\n\n` +
      `Atualização mensal: basta substituir o(s) .parquet.\n\nAbrir agora?`;
    if (await confirmDialog(msg, { title: '☁ Publish app', confirmLabel: 'Abrir' })) window.open(r.previewUrl, '_blank');
  }

  // Árvore de arquivos: raiz + um nível de pastas (agrupado pelo 1º segmento do caminho).
  const tree = (() => {
    const rootFiles: string[] = [];
    const dirs: Record<string, string[]> = {};
    for (const f of files) {
      const i = f.indexOf('/');
      if (i === -1) rootFiles.push(f);
      else (dirs[f.slice(0, i)] = dirs[f.slice(0, i)] || []).push(f);
    }
    return { rootFiles, dirs };
  })();

  const cmTheme = settings?.theme?.mode === 'dark' ? 'dark' : 'light';

  return (
    <div className="editor-page">
      <div className="editor-bar">
        <b className="proj-name">{project}</b>
        <span className="file-label" title={activeQuery ? 'queries/' + activeQuery : active}>
          {activeQuery ? 'queries/' + activeQuery : active || '—'}
        </span>
        <div className="mode-switch">
          <button className={mode === 'notebook' ? 'active' : ''} onClick={() => setMode('notebook')}>
            Notebook
          </button>
          <button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>
            Dividido
          </button>
          <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>
            Fonte
          </button>
        </div>
        {active.endsWith('.md') && active && (
          <div className="lint-wrap">
            <button
              className={
                'lint-badge ' +
                (lint.some((f) => f.level === 'error') ? 'err' : lint.some((f) => f.level === 'warn') ? 'warn' : 'ok')
              }
              onClick={() => setLintOpen((o) => !o)}
              title="Compatibilidade com o Evidence.dev (deploy on-premise)"
            >
              {lint.length === 0
                ? 'Evidence ✓'
                : `Evidence ${lint.some((f) => f.level !== 'info') ? '⚠' : 'ℹ'} ${lint.length}`}
            </button>
            {lintOpen && (
              <div className="lint-panel">
                <div className="lint-head">
                  Compatibilidade Evidence
                  <button onClick={() => setLintOpen(false)} title="Fechar">
                    ×
                  </button>
                </div>
                {lint.length === 0 && (
                  <div className="lint-item info">
                    <span className="lint-msg">Nenhum problema — a página é portável para o Evidence.</span>
                  </div>
                )}
                {lint.map((f, i) => (
                  <div key={i} className={'lint-item ' + f.level}>
                    <span className="lint-lvl">{f.level === 'error' ? '✕' : f.level === 'warn' ? '⚠' : 'ℹ'}</span>
                    <span className="lint-ctx">{f.context}</span>
                    <span className="lint-msg">{f.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="save" onClick={save}>
          {saved ? 'Salvo ✓' : 'Salvar *'}
        </button>
        <button className="publish" onClick={publish} disabled={publishing} title="HTML único offline (snapshot)">
          {publishing ? 'Publicando…' : '📦 Publish'}
        </button>
        <button className="publish-app" onClick={publishApp} disabled={publishingApp} title="Parquet + DuckDB-WASM (Universal SQL)">
          {publishingApp ? 'Gerando…' : '☁ Publish app'}
        </button>
      </div>

      {paramName && (
        <div className="param-bar">
          <b>Página parametrizada:</b> <code>{paramName}</code> =
          {paramValues.length > 0 ? (
            <select value={paramValue} onChange={(e) => setParamValue(e.target.value)}>
              {paramValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              placeholder="digite um valor…"
              value={paramValue}
              onChange={(e) => setParamValue(e.target.value)}
              style={{ minWidth: 160 }}
            />
          )}
          <span className="muted small">Preview ao vivo para este valor.</span>
        </div>
      )}

      <div className="editor-body">
        <aside className="ftree">
          <div className="ftree-actions">
            <button onClick={newFile} title="Novo arquivo">
              ＋
            </button>
            <button onClick={newParamPages} title="Nova página por… ([param].md + index.md)">
              ✨
            </button>
            <button onClick={() => navigate(`/projects/${project}/new-report?mode=blocks`)} title="Wizard de View Block (Fonte → Seleção → Argumentos → Apresentação)">
              ▣
            </button>
            {active && (
              <button onClick={delFile} title={`Excluir ${active}`}>
                🗑
              </button>
            )}
          </div>
          {tree.rootFiles.map((f) => (
            <div key={f} className={'ftree-item' + (f === active ? ' active' : '')} onClick={() => open(f)} title={f}>
              📄 {f}
            </div>
          ))}
          {Object.entries(tree.dirs).map(([d, fs]) => (
            <div key={d}>
              <div className="ftree-dir">📁 {d}</div>
              {fs.map((f) => (
                <div key={f} className={'ftree-item sub' + (f === active ? ' active' : '')} onClick={() => open(f)} title={f}>
                  📄 {f.slice(d.length + 1)}
                </div>
              ))}
            </div>
          ))}
          <div>
              <div className="ftree-dir ftree-queries">
                🧮 queries
                <button className="ftree-mini" onClick={newQueryFile} title="Novo arquivo .sql">
                  ＋
                </button>
              </div>
              {queryFiles.map((f) => (
                <div
                  key={f}
                  className={'ftree-item sub' + (f === activeQuery ? ' active' : '')}
                  onClick={() => openQuery(f)}
                  title={'queries/' + f}
                >
                  🧮 {f}
                </div>
              ))}
            </div>
        </aside>

        <div className="editor-main">
          {activeQuery && (
            <div className="editor-query">
              <div className="qrun-bar">
                <button className="run" onClick={runQueryFile} disabled={qRunning}>
                  {qRunning ? 'Rodando…' : '▶ Rodar'}
                </button>
                <label>
                  Limite
                  <input
                    type="number"
                    min={1}
                    value={qLimit}
                    onChange={(e) => setQLimit(Number(e.target.value))}
                    style={{ width: 72 }}
                  />
                </label>
                {qParamNames.map((p) => (
                  <label key={'p:' + p} title={'valor de teste para ${params.' + p + '}'}>
                    <code>params.{p}</code>
                    <input
                      placeholder="valor de teste"
                      value={qVals['p:' + p] ?? ''}
                      onChange={(e) => setQVals((v) => ({ ...v, ['p:' + p]: e.target.value }))}
                      style={{ width: 140 }}
                    />
                  </label>
                ))}
                {qInputNames.map((n) => (
                  <label key={'i:' + n} title={'valor de teste para ${inputs.' + n + '}'}>
                    <code>inputs.{n}</code>
                    <input
                      placeholder="valor de teste"
                      value={qVals['i:' + n] ?? ''}
                      onChange={(e) => setQVals((v) => ({ ...v, ['i:' + n]: e.target.value }))}
                      style={{ width: 140 }}
                    />
                  </label>
                ))}
                <span className="muted small">Ctrl+Enter roda · Ctrl+S salva</span>
              </div>
              <div className="editor-source">
                <CodeMirror value={content} height="100%" theme={cmTheme} extensions={[sqlLang()]} onChange={update} />
              </div>
              {qRes && (
                <div className="qrun-results">
                  <ResultsGrid columns={qRes.columns} rows={qRes.rows} error={qRes.error} />
                </div>
              )}
            </div>
          )}

          {!activeQuery && mode === 'notebook' && (
            <div className="editor-notebook">
              <Notebook
                value={content}
                onChange={update}
                params={params}
                paramNames={paramRefs}
                project={project}
                onEditViewblock={async (vbId, step) => {
                  await save(); // o wizard lê a página do disco
                  navigate(`/projects/${project}/new-report?edit=${encodeURIComponent(vbId)}&page=${encodeURIComponent(active)}&step=${step}`);
                }}
              />
            </div>
          )}

          {!activeQuery && mode === 'split' && (
            <div className="editor-split">
              <div className="editor-left">
                <CodeMirror value={content} height="100%" theme={cmTheme} extensions={[markdown()]} onChange={update} />
              </div>
              <div className="editor-right">
                <PreviewRenderer source={content} settings={settings} params={params} onLink={onLink} loadQuery={loadQuery} project={project} />
              </div>
            </div>
          )}

          {!activeQuery && mode === 'source' && (
            <div className="editor-source">
              <CodeMirror value={content} height="100%" theme={cmTheme} extensions={[markdown()]} onChange={update} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
