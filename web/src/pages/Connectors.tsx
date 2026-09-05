import { useRef, useState, useEffect, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { jget, jdel, jput, jpost, upload } from '../api';
import { alertDialog, confirmDialog, formDialog } from '../components/dialogs';

// Painel "Fontes" do espaço Dados: upload e listagem das fontes DO PROJETO
// (projects/<p>/sources/ → views no schema proj_<slug>).
export default function SourcesPanel({ project, onChanged }: { project: string; onChanged?: () => void }) {
  const [sources, setSources] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = '/projects/' + project + '/sources';
  const load = () => jget(base).then((d) => setSources(d.sources || []));

  // ⚙ Arquiteto: project.yaml (conexões/views materializadas/mounts) + segredos.
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgText, setCfgText] = useState('');
  const [cfg, setCfg] = useState<any>({});
  const [cfgErrors, setCfgErrors] = useState<{ path: string; message: string }[]>([]);
  const [refreshing, setRefreshing] = useState('');
  const loadCfg = useCallback(
    () =>
      jget('/projects/' + project + '/config').then((d) => {
        setCfgText(d.content || '');
        setCfg(d.config || {});
        setCfgErrors(d.errors || []);
      }),
    [project]
  );
  useEffect(() => {
    load();
    loadCfg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  async function saveCfg() {
    const r = await jput('/projects/' + project + '/config', { content: cfgText });
    setCfgErrors(r.errors || []);
    if (r.ok) loadCfg();
  }

  async function gravarSegredo() {
    const v = await formDialog({
      title: 'Gravar segredo (.secrets.json — nunca versiona, nunca vai ao browser)',
      confirmLabel: 'Gravar',
      fields: [
        { name: 'ref', label: 'credentials_ref (nome usado no project.yaml)', placeholder: 'dw_producao' },
        { name: 'value', label: 'valor (connection string / chave)', placeholder: 'postgres://user:senha@host:5432/db' },
      ],
    });
    if (!v || !v.ref || !v.value) return;
    const r = await jput('/projects/' + project + '/secrets', { ref: v.ref, value: v.value });
    if ((r as any).error) alertDialog((r as any).error);
    else alertDialog(`Segredo "${v.ref}" gravado (write-only).`);
  }

  async function refresh(name: string) {
    setRefreshing(name);
    const r = await jpost('/projects/' + project + '/materialized/' + encodeURIComponent(name) + '/refresh', {});
    setRefreshing('');
    if (r.error) alertDialog('↻ falhou (timestamp anterior mantido; parquet em uso íntegro):\n\n' + r.error);
    else setMsg(`↻ ${name} materializada em ${new Date(r.materializedAt).toLocaleString()}`);
    load(); // sucesso OU falha: recarrega para exibir last_refresh/last_error
    onChanged?.();
  }

  // ＋ Nova fonte (DELTA §3): Arquivo · View materializada · Mount.
  const [nv, setNv] = useState<{ name: string; connection: string; query: string; preview: any } | null>(null);
  const [conns, setConns] = useState<string[]>([]);
  async function novaFonte() {
    const v = await formDialog({
      title: 'Nova fonte',
      confirmLabel: 'Avançar',
      fields: [
        {
          name: 'tipo',
          label: 'Tipo de fonte',
          type: 'select',
          options: [
            { value: 'arquivo', label: 'Arquivo (CSV/Parquet/JSON)' },
            { value: 'materializada', label: 'View materializada (banco → parquet)' },
            { value: 'mount', label: 'Mount (bucket/pasta — Airflow escreve)' },
          ],
        },
      ],
    });
    if (!v) return;
    if (v.tipo === 'arquivo') {
      fileRef.current?.click();
      return;
    }
    if (v.tipo === 'mount') {
      const m = await formDialog({
        title: 'Novo mount',
        confirmLabel: 'Registrar',
        fields: [
          { name: 'name', label: 'Nome do mount', placeholder: 'lake' },
          { name: 'base_url', label: 'Base URL (http(s)://, s3:// ou pasta)', placeholder: 's3://bucket/studio' },
          { name: 'prefix', label: 'Prefixo (opcional)', placeholder: '' },
        ],
      });
      if (!m || !m.name || !m.base_url) return;
      const r = await jpost('/projects/' + project + '/mounts', m);
      if (r.error) alertDialog(r.error);
      else setMsg(`Mount "${r.mount}": ${(r.registered || []).length} fonte(s) registrada(s).`);
      load();
      return;
    }
    // View materializada: conexão (registro global) → query → nome (DELTA §3)
    const d = await jget('/connections');
    const names = (d.connections || []).map((c: any) => c.name);
    if (!names.length) {
      alertDialog('Nenhuma conexão registrada — cadastre no menu global Conexões (arquiteto).');
      return;
    }
    const s = await formDialog({
      title: 'View materializada',
      message: 'A query roda no banco SÓ na extração (↻); as páginas leem o parquet local.',
      confirmLabel: 'Escrever query…',
      fields: [
        { name: 'connection', label: 'Conexão (registro global)', type: 'select', options: names.map((n: string) => ({ value: n })) },
        { name: 'name', label: 'Nome da fonte (vira sources/<nome>.parquet)', placeholder: 'pagamentos' },
      ],
    });
    if (!s || !s.name) return;
    setConns(names);
    setNv({ name: s.name, connection: s.connection, query: 'select * from ext.<tabela>', preview: null });
  }

  async function nvPreview() {
    if (!nv) return;
    const r = await jpost('/connections/' + encodeURIComponent(nv.connection) + '/preview', { query: nv.query });
    setNv({ ...nv, preview: r });
  }

  async function nvMaterializar() {
    if (!nv) return;
    const r = await jpost('/projects/' + project + '/materialized', { name: nv.name, connection: nv.connection, query: nv.query });
    if (r.error) {
      alertDialog(r.error);
      return;
    }
    setMsg(`Fonte "${nv.name}" materializada em ${new Date(r.materializedAt).toLocaleString()}.`);
    setNv(null);
    load();
    onChanged?.();
  }

  async function uploadFile(file: File) {
    setBusy(true);
    setMsg('Enviando ' + file.name + '…');
    const r = await upload(base + '/upload', file);
    setBusy(false);
    setMsg(r.error ? 'Erro: ' + r.error : 'Fonte registrada: ' + r.name);
    load();
    onChanged?.();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  }

  async function remove(name: string) {
    if (!(await confirmDialog('Remover a fonte "' + name + '" do projeto?', { confirmLabel: 'Remover', danger: true }))) return;
    await jdel(base + '/' + name);
    load();
    onChanged?.();
  }

  return (
    <div className="conn">
      {/* Dropzone */}
      <div
        className={'dropzone' + (drag ? ' drag' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <div className="dz-ico">⇪</div>
        <div className="dz-main">
          <div className="dz-title">Arraste CSV, Parquet ou JSON aqui</div>
          <div className="dz-sub">
            {busy ? msg : `Cada arquivo vira uma tabela do projeto "${project}" · máx. 500 MB`}
          </div>
        </div>
        <button className="run" onClick={() => fileRef.current?.click()} disabled={busy}>
          Escolher arquivo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.parquet,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {msg && !busy && <div className="muted small" style={{ marginBottom: 18 }}>{msg}</div>}

      <button className="run" style={{ marginBottom: 14 }} onClick={novaFonte}>
        ＋ Nova fonte
      </button>

      {/* Construtor de view materializada (conexão → query com ▶ Preview → materializar) */}
      {nv && (
        <div className="sem-editor" style={{ marginBottom: 18 }}>
          <div className="sem-bar">
            <span className="mono small">
              nova fonte: <b>{nv.name}</b> ←{' '}
              <select value={nv.connection} onChange={(e) => setNv({ ...nv, connection: e.target.value })}>
                {conns.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
            <div className="nb-spacer" />
            <button onClick={nvPreview}>▶ Preview (100)</button>
            <button className="save" onClick={nvMaterializar}>
              Materializar e registrar
            </button>
            <button onClick={() => setNv(null)}>Cancelar</button>
          </div>
          <CodeMirror value={nv.query} height="140px" onChange={(v) => setNv({ ...nv, query: v, preview: nv.preview })} basicSetup={{ lineNumbers: true }} />
          {nv.preview?.error && <div className="error" style={{ margin: '6px 12px' }}>{nv.preview.error}</div>}
          {nv.preview?.rows && (
            <div style={{ padding: '8px 12px', overflowX: 'auto' }}>
              <div className="muted small">{nv.preview.rows.length} linha(s) no preview</div>
              <table className="grid">
                <thead>
                  <tr>{nv.preview.columns.map((c: string) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {nv.preview.rows.slice(0, 8).map((r: any, i: number) => (
                    <tr key={i}>{nv.preview.columns.map((c: string) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Fontes do projeto */}
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Fontes do projeto · {sources.length}
      </div>
      {sources.length === 0 && <div className="home-empty">Nenhuma fonte neste projeto ainda.</div>}
      <div className="conn-grid">
        {sources.map((s) => {
          const cols = s.columns || [];
          return (
            <div key={s.name} className="conn-card">
              <div className="conn-card-head">
                <span className={'conn-badge' + (s.kind === 'materialized' ? ' view' : '')}>{s.kind === 'materialized' ? 'VIEW MAT.' : 'FONTE'}</span>
                <span className="conn-name">{s.name}</span>
                {s.stale && !s.lastError && (
                  <span className="pj-badge" title="mais antiga que stale_after — considere ↻">
                    possivelmente desatualizada
                  </span>
                )}
                {s.kind === 'materialized' && (
                  <button
                    className="conn-x"
                    style={{ color: 'var(--data)' }}
                    title="↻ Atualizar (re-executa a extração; arquiteto)"
                    disabled={refreshing === s.name}
                    onClick={() => refresh(s.name)}
                  >
                    {refreshing === s.name ? '…' : '↻'}
                  </button>
                )}
                <span className="conn-meta">{cols.length} col</span>
                <button className="conn-x" title="Remover fonte" onClick={() => remove(s.name)}>
                  ✕
                </button>
              </div>
              <div className="conn-schema">
                {cols.slice(0, 6).map((c: any) => (
                  <span key={c.name} className="conn-chip">
                    {c.name} <span className="t">{String(c.type).toLowerCase()}</span>
                  </span>
                ))}
                {cols.length > 6 && <span className="conn-chip more">+{cols.length - 6}</span>}
              </div>
              {s.materializedAt && (
                <div className="muted small" style={{ marginTop: 6 }} title={s.kind === 'mount' ? 'objeto atualizado em (refresh é do Airflow)' : 'última extração bem-sucedida'}>
                  Última atualização: {new Date(s.materializedAt).toLocaleString()}
                </div>
              )}
              {s.lastError && (
                <div className="error" style={{ marginTop: 6, fontSize: 12 }} title="último ↻ falhou — o parquet em uso segue íntegro (timestamp acima é da última extração boa)">
                  ✕ {String(s.lastError).split('\n')[0]}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ⚙ Arquiteto: conexões, views materializadas e mounts (project.yaml) */}
      <div className="eyebrow" style={{ margin: '28px 0 10px', cursor: 'pointer' }} onClick={() => setCfgOpen(!cfgOpen)}>
        {cfgOpen ? '▾' : '▸'} Conexões, views materializadas & mounts (arquiteto)
      </div>
      {cfgOpen && (
        <div className="sem-editor" style={{ maxWidth: 900 }}>
          <div className="sem-bar">
            <span className="mono small">project.yaml — versionável, SEM segredos (use credentials_ref)</span>
            <div className="nb-spacer" />
            <button onClick={gravarSegredo}>🔑 Gravar segredo…</button>
            <button className="save" onClick={saveCfg}>
              Salvar
            </button>
          </div>
          <CodeMirror value={cfgText} height="260px" onChange={setCfgText} basicSetup={{ lineNumbers: true }} />
          {cfgErrors.map((e, i) => (
            <div key={i} className="error" style={{ margin: '6px 12px' }}>
              <b className="mono">{e.path}</b>: {e.message}
            </div>
          ))}
          {Object.keys(cfg.materialized || {}).length > 0 && (
            <div style={{ padding: '10px 12px' }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Views materializadas</div>
              {Object.entries(cfg.materialized || {}).map(([name, m]: [string, any]) => (
                <div key={name} className="row" style={{ marginBottom: 6 }}>
                  <span className="mono small">
                    {name} ← {m.connection}
                  </span>
                  <button onClick={() => refresh(name)} disabled={refreshing === name} title="ATTACH efêmero → COPY → sources/<nome>.parquet">
                    {refreshing === name ? 'Extraindo…' : '↻ Refresh'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
