import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { jget, jput, jpost, jdel } from '../api';
import { alertDialog, confirmDialog, formDialog } from '../components/dialogs';

// F6 — Relatórios spec-driven: a SPEC.md é a fonte; páginas são build.
// Lista com estado + tela por relatório (Especificação/Estrutura/Páginas/
// Diagnósticos/Publicações).

const ESTADOS: Record<string, { label: string; cls: string; hint: string }> = {
  ok: { label: 'ok', cls: 'ok', hint: 'páginas batem byte a byte com o build da spec' },
  pendente: { label: 'pendente', cls: 'warn', hint: 'há páginas por construir ou mudanças da spec ainda não buildadas — rode o build (livre)' },
  divergente: { label: 'divergente', cls: 'warn', hint: 'página editada à mão — Recompilar (spec vence) ou Reabsorver (página vence)' },
  desatualizado: { label: 'desatualizado', cls: 'warn', hint: 'o catálogo mudou desde o último build — recompile' },
  quebrado: { label: 'quebrado', cls: 'bad', hint: 'a spec tem erros de validação' },
};

function Badge({ state }: { state: string }) {
  const e = ESTADOS[state] || { label: state, cls: '', hint: '' };
  return <span className={'rep-badge ' + e.cls} title={e.hint}>{e.label}</span>;
}

export function ReportsList() {
  const { project = '' } = useParams();
  const nav = useNavigate();
  const [reports, setReports] = useState<any[]>([]);
  const load = useCallback(() => jget(`/projects/${project}/reports`).then((d) => setReports(d.reports || [])), [project]);
  useEffect(() => {
    load();
  }, [load]);

  async function promover() {
    const v = await formDialog({
      title: '⬆ Promover páginas a relatório',
      message: 'Reconstrói a spec a partir dos marcadores View Block das páginas (só páginas com blocos semânticos).',
      confirmLabel: 'Promover',
      fields: [
        { name: 'name', label: 'Nome do relatório', placeholder: 'panorama_apc' },
        { name: 'pages', label: 'Páginas (separadas por vírgula)', placeholder: 'apc_semantico.md' },
      ],
    });
    if (!v?.name || !v?.pages) return;
    const r = await jpost(`/projects/${project}/reports/promote`, { name: v.name, pages: v.pages.split(',').map((s: string) => s.trim()).filter(Boolean) });
    if (r.error) return alertDialog(r.error, 'Promover');
    await load();
    nav(`/projects/${project}/reports/${r.slug}`);
  }

  return (
    <div className="page">
      <h1>▦ Relatórios</h1>
      <p className="muted small">
        Spec-driven: cada relatório tem uma <b>spec</b> (<span className="mono">reports/&lt;slug&gt;.md</span> — narrativa +
        contrato) que é a fonte da verdade. As páginas são <b>build</b>: catálogo mudou? Um clique recompila tudo. Blocos
        reeditados pelo wizard sincronizam de volta.
      </p>
      <div className="row" style={{ gap: 10 }}>
        <button className="run" onClick={() => nav(`/projects/${project}/new-report?mode=ai`)}>＋ Novo relatório (✨ descrever)</button>
        <button onClick={promover}>⬆ Promover páginas existentes</button>
      </div>
      <div className="pj-grid" style={{ marginTop: 16 }}>
        {reports.map((r) => (
          <Link key={r.slug} to={`/projects/${project}/reports/${r.slug}`} className="pj-card">
            <div className="pj-head">
              <span className="pj-name">{r.title || r.slug}</span>
              <Badge state={r.state} />
            </div>
            <div className="pj-meta mono small">reports/{r.slug}.md · {(r.pages || []).length} página(s)</div>
          </Link>
        ))}
        {reports.length === 0 && <div className="muted">Nenhuma spec ainda — gere pelo ✨ ou promova páginas existentes.</div>}
      </div>
    </div>
  );
}

const ABAS = ['Especificação', 'Estrutura', 'Páginas', 'Diagnósticos', 'Publicações'] as const;

export default function ReportView() {
  const { project = '', slug = '' } = useParams();
  const nav = useNavigate();
  // ?aba= permite deep-link direto numa aba (ex.: /reports/x?aba=Páginas)
  const [search] = useSearchParams();
  const abaInicial = ABAS.find((a) => a === search.get('aba')) || 'Especificação';
  const [aba, setAba] = useState<(typeof ABAS)[number]>(abaInicial);
  const [rep, setRep] = useState<any>(null);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState('');
  const base = `/projects/${project}/reports/${slug}`;

  const load = useCallback(async () => {
    const d = await jget(base);
    setRep(d);
    setContent(d.content || '');
    setSaved(true);
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  if (!rep) return <div className="page muted">Carregando…</div>;
  const st = rep.status || { state: 'quebrado', pages: [] };
  const spec = rep.spec;

  async function salvar() {
    const r = await jput(base, { content });
    setSaved(true);
    await load();
    if ((r.errors || []).length) setAba('Diagnósticos');
  }
  async function build(force: string[] = []) {
    setBusy('build');
    const r = await jpost(base + '/build', { force });
    setBusy('');
    if (r.diverged) {
      const ok = await confirmDialog(
        `Páginas com edição manual (divergentes):\n\n${r.diverged.map((x: string) => '• ' + x).join('\n')}\n\nRecompilar por cima? (a alternativa é Reabsorver na aba Páginas)`,
        { title: 'Divergência', confirmLabel: 'Recompilar por cima', danger: true }
      );
      if (ok) return build([...force, ...r.diverged]);
      return;
    }
    if (r.error || r.errors) alertDialog(r.error || (r.errors || []).map((e: any) => `${e.path}: ${e.message}`).join('\n'), 'Build');
    await load();
  }
  async function reabsorver(pages?: string[], prose = false) {
    setBusy('absorb');
    const r = await jpost(base + '/absorb', { ...(pages ? { pages } : {}), ...(prose ? { prose: true } : {}) });
    setBusy('');
    if (r.error) {
      alertDialog(r.error, 'Reabsorver');
      await load();
      return;
    }
    // Prosa é heurística (perde posição) — só entra com o seu aval, vendo o texto.
    if (r.proseDiff && Object.keys(r.proseDiff).length) {
      const resumo = Object.entries(r.proseDiff)
        .map(([pg, txt]) => `— ${pg}:\n${String(txt).slice(0, 400)}`)
        .join('\n\n');
      const ok = await confirmDialog(
        `Os blocos foram reabsorvidos. Há TEXTO MANUAL nas páginas que não é dos blocos:\n\n${resumo}\n\nCapturar esse texto no campo prose: da spec? (a posição original pode mudar no rebuild)`,
        { title: 'Prosa manual encontrada', confirmLabel: 'Capturar prose' }
      );
      if (ok) return reabsorver(pages, true);
    }
    await load();
  }
  async function publicar(path: string, modo: 'publish' | 'publish-app') {
    setBusy(path + modo);
    const r = await jpost(`/projects/${project}/${modo}`, { path, visibility: spec?.visibility || 'public' });
    setBusy('');
    if (r.error) return alertDialog(r.error, 'Publicar');
    alertDialog(modo === 'publish' ? `📦 ${r.file} publicado` : `☁ ${r.page}-app publicado`, 'Publicar');
  }
  async function excluir() {
    if (!(await confirmDialog(`Excluir a spec ${slug}? As páginas construídas FICAM (viram soltas).`, { confirmLabel: 'Excluir', danger: true }))) return;
    await jdel(base);
    nav(`/projects/${project}/reports`);
  }

  return (
    <div className="page">
      <h1>
        ▦ {spec?.title || slug} <Badge state={st.state} />
      </h1>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="publish-app" disabled={!!busy || !rep.valid} onClick={() => build()} title={ESTADOS[st.state]?.hint}>
          {busy === 'build' ? 'Construindo…' : '⚡ Build (recompilar páginas)'}
        </button>
        <button disabled={!!busy} onClick={() => reabsorver()} title="páginas vencem: reconstrói blocks/prose da spec a partir do que está no disco">
          ⬇ Reabsorver tudo
        </button>
        <div className="nb-spacer" />
        <button className="danger" onClick={excluir}>Excluir spec</button>
      </div>

      <div className="wiz-steps">
        {ABAS.map((a) => (
          <button key={a} className={'wiz-tab' + (a === aba ? ' active' : '')} onClick={() => setAba(a)}>
            {a}
          </button>
        ))}
      </div>

      {aba === 'Especificação' && (
        <div>
          <div className="sem-bar">
            <span className="mono small">reports/{slug}.md — narrativa é sua; o contrato vive no fence ```studio-report</span>
            <div className="nb-spacer" />
            <button className="save" onClick={salvar}>{saved ? 'Salvo ✓' : 'Salvar *'}</button>
          </div>
          <CodeMirror value={content} height="480px" onChange={(v) => (setContent(v), setSaved(false))} basicSetup={{ lineNumbers: true }} />
          {rep.errors?.length > 0 && rep.errors.map((e: any, i: number) => (
            <div key={i} className="error" style={{ marginTop: 6 }}>
              <b className="mono">{e.path || '(raiz)'}</b>: {e.message}
            </div>
          ))}
        </div>
      )}

      {aba === 'Estrutura' && spec && (
        <div className="ra-plan">
          <p className="muted small">catálogo <b>{spec.catalog}</b> · {spec.visibility} · {(spec.globalParams || []).map((p: any) => p.name).join(', ') || 'sem parâmetros globais'}</p>
          {(spec.pages || []).map((pg: any) => (
            <div key={pg.path} className="ra-page">
              <div className="ra-page-head">
                <b>{pg.title}</b> <span className="mono small muted">{pg.path}</span>
                {pg.parameter && <span className="pj-badge">por {pg.parameter.dimension}</span>}
              </div>
              {(pg.blocks || []).map((b: any, i: number) => (
                <div key={i} className="ra-block">
                  <span className="nb-vb-style">{b.style}</span> {b.title && <b>{b.title}</b>}
                  <div className="ra-chips">
                    {(b.metrics || []).map((m: string) => <span key={m} className="param-chip on">Σ {m}</span>)}
                    {(b.dims || []).map((d: any, j: number) => <span key={j} className="param-chip">{d.dim}{d.level ? '.' + d.level : ''}</span>)}
                    {(b.filters || []).map((f: any, j: number) => <span key={j} className="param-chip ra-filter">{f.dim}{f.level ? '.' + f.level : ''} = {(f.values || []).join(', ')}</span>)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {aba === 'Páginas' && (
        <div>
          {(st.pages || []).map((p: any) => (
            <div key={p.path} className="rep-page-row">
              <span className="mono">{p.path}</span>
              {!p.exists && <span className="rep-badge warn">pendente</span>}
              {p.stale && <span className="rep-badge warn">desatualizada</span>}
              {p.diverged && <span className="rep-badge warn" title="a PÁGINA mudou desde o último build">divergente</span>}
              {p.specAhead && <span className="rep-badge warn" title="a SPEC mudou desde o último build — recompile livre">spec à frente</span>}
              {p.exists && !p.stale && !p.diverged && !p.specAhead && <span className="rep-badge ok">ok</span>}
              <div className="nb-spacer" />
              {p.exists && (
                <button onClick={() => (localStorage.setItem('studio.file.' + project, p.path), nav('/projects/' + project))}>Abrir no editor</button>
              )}
              <button disabled={!!busy} onClick={() => build(p.diverged ? [p.path] : [])} title="spec vence">↻ Recompilar</button>
              {p.exists && (
                <button disabled={!!busy} onClick={() => reabsorver([p.path])} title="página vence: blocos e prose voltam para a spec">⬇ Reabsorver</button>
              )}
            </div>
          ))}
        </div>
      )}

      {aba === 'Diagnósticos' && (
        <div>
          <p>
            Estado: <Badge state={st.state} /> <span className="muted small">{ESTADOS[st.state]?.hint}</span>
          </p>
          {[...(rep.errors || []), ...((st.errors || []) as any[])].map((e: any, i: number) => (
            <div key={i} className="error" style={{ marginTop: 6 }}>
              <b className="mono">{e.path || '(raiz)'}</b>: {e.message}
            </div>
          ))}
          {(st.pages || []).filter((p: any) => p.stale || p.diverged || !p.exists).map((p: any) => (
            <div key={p.path} className="muted small" style={{ marginTop: 4 }}>
              • {p.path}: {!p.exists ? 'ainda não construída' : p.stale ? 'marcadores com catalogHash antigo' : 'editada à mão desde o build'}
            </div>
          ))}
          {rep.valid && st.state === 'ok' && <p className="muted">✓ Nada a apontar — spec válida e páginas em dia.</p>}
        </div>
      )}

      {aba === 'Publicações' && (
        <div>
          <p className="muted small">Visibilidade da spec: <b>{spec?.visibility}</b> (políticas PII aplicam no publish).</p>
          {(st.pages || []).filter((p: any) => p.exists).map((p: any) => (
            <div key={p.path} className="rep-page-row">
              <span className="mono">{p.path}</span>
              <div className="nb-spacer" />
              <button disabled={!!busy || p.path.includes('[')} title={p.path.includes('[') ? 'parametrizada: só ☁' : 'HTML único offline'} onClick={() => publicar(p.path, 'publish')}>
                📦 Snapshot
              </button>
              <button disabled={!!busy} title="Parquet + DuckDB-WASM" onClick={() => publicar(p.path, 'publish-app')}>
                ☁ App
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
