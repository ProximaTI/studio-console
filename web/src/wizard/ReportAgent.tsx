import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { jget, jpost } from '../api';
import { confirmDialog } from '../components/dialogs';
import Wizard from './Wizard';

// F5 (M31): porta "✨ Descrever relatório completo" — Objetivo → Plano → Gerar.
// A IA propõe um ReportPlan (só nomes do catálogo); o servidor valida e o
// compilador determinístico gera as páginas. Ajustes finos = reedição ▣/Σ/⚙
// que todo View Block gerado já tem.

type PlanBlock = { id?: string; title?: string; metrics: string[]; dims: { dim: string; level?: string }[]; filters: { dim: string; level?: string; values: any[] }[]; style: string; explanation?: string };
type PlanPage = { path: string; title: string; purpose?: string; parameter?: { name: string; dimension: string }; blocks: PlanBlock[] };
type Plan = { version: 1; title: string; purpose: string; visibility: string; catalog: string; globalParams: any[]; pages: PlanPage[]; warnings: string[] };

function ReportAgent({ project }: { project: string }) {
  const navigate = useNavigate();
  const [aiEnabled, setAiEnabled] = useState(true);
  const [models, setModels] = useState<any[]>([]);
  const [model, setModel] = useState('');
  const [request, setRequest] = useState('');
  const [audience, setAudience] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [descartes, setDescartes] = useState<Set<string>>(new Set()); // 'path' ou 'path#idx'
  const [nota, setNota] = useState('');

  useEffect(() => {
    jget('/ai/status').then((d) => setAiEnabled(!!d.enabled)).catch(() => {});
    jget('/projects/' + project + '/semantic').then((d) => {
      const v = (d.models || []).filter((m: any) => m.valid);
      setModels(v);
      if (v.length === 1) setModel(v[0].model);
    });
  }, [project]);

  async function propor(anotacao?: string) {
    setBusy(true);
    setErro('');
    const texto = anotacao ? `${request}\n\nAjustes pedidos pelo usuário sobre a proposta anterior: ${anotacao}` : request;
    const r = await jpost(`/projects/${project}/agent/report-plan`, { request: texto, catalog: model || undefined, audience: audience || undefined, visibility });
    setBusy(false);
    if (r.error) {
      setErro(r.error);
      return;
    }
    if (r.choose) {
      setErro('Escolha o modelo semântico acima e proponha de novo.');
      return;
    }
    setPlan(r.plan);
    setErrors(r.errors || []);
    setDescartes(new Set());
    setNota('');
  }

  // Plano efetivo = o proposto menos os descartes (página sem bloco cai junto).
  const efetivo = useMemo(() => {
    if (!plan) return null;
    const pages = plan.pages
      .filter((pg) => !descartes.has(pg.path))
      .map((pg) => ({ ...pg, blocks: pg.blocks.filter((_, i) => !descartes.has(pg.path + '#' + i)) }))
      .filter((pg) => pg.blocks.length > 0);
    return { ...plan, pages };
  }, [plan, descartes]);

  // Erros ATIVOS: descartar a página/bloco inválido resolve o erro dele — o
  // gate do Gerar só considera o que vai ser gravado (o apply revalida tudo).
  const errosAtivos = useMemo(() => {
    if (!plan) return errors;
    return errors.filter((e) => {
      const m = String(e.path).match(/^pages\[(\d+)\](?:\.blocks\[(\d+)\])?/);
      if (!m) return true;
      const pg = plan.pages[Number(m[1])];
      if (!pg) return true;
      if (descartes.has(pg.path)) return false;
      if (m[2] !== undefined && descartes.has(pg.path + '#' + m[2])) return false;
      return true;
    });
  }, [plan, errors, descartes]);

  async function gerar() {
    if (!efetivo || !efetivo.pages.length) return;
    setBusy(true);
    setErro('');
    let r = await jpost(`/projects/${project}/agent/report-apply`, { plan: efetivo, saveSpec: true });
    if (r.conflicts?.length) {
      setBusy(false);
      const ok = await confirmDialog(
        `Estas páginas JÁ existem no projeto:\n\n${r.conflicts.map((c: string) => '• ' + c).join('\n')}\n\nSobrescrever?`,
        { title: 'Conflitos', confirmLabel: 'Sobrescrever', danger: true }
      );
      if (!ok) return;
      setBusy(true);
      r = await jpost(`/projects/${project}/agent/report-apply`, { plan: efetivo, overwrite: r.conflicts, saveSpec: true });
    }
    setBusy(false);
    if (r.error || r.errors) {
      setErro(r.error || (r.errors || []).map((e: any) => `${e.path}: ${e.message}`).join(' · '));
      return;
    }
    localStorage.setItem('studio.file.' + project, r.written[0]);
    // F6: a SPEC.md foi gravada junto — aterrissa na tela do relatório
    navigate(r.spec ? `/projects/${project}/reports/${r.spec}` : '/projects/' + project);
  }

  const toggle = (k: string) => setDescartes((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  if (!models.length)
    return (
      <div className="page">
        <h1>✨ Relatório completo</h1>
        <p className="muted">
          Este fluxo planeja sobre um <b>modelo semântico</b> e o projeto ainda não tem nenhum válido. Crie um em{' '}
          <b>Dados › Semântica</b> (o botão "✨ Gerar rascunho do modelo" ajuda) e volte aqui.
        </p>
      </div>
    );

  return (
    <div className="page wiz">
      <h1>✨ Relatório completo</h1>
      <p className="muted small">
        Descreva o relatório; a IA propõe um plano (páginas → blocos) usando SÓ o catálogo — SQL e Markdown saem do
        compilador. Você revisa antes de gerar; cada bloco gerado segue reeditável (▣/Σ/⚙).
      </p>

      {!plan && (
        <div className="ra-obj">
          {!aiEnabled && <div className="error">Agente não configurado — Settings › Agente (LM Studio ou Anthropic).</div>}
          <textarea
            className="ra-req"
            rows={5}
            placeholder='ex.: "relatório executivo da rede: visão geral com KPIs de atendimentos e faturamento, gráfico por unidade, mapa por UF; e uma página de detalhe por unidade filtrada em 2025"'
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {models.length > 1 && (
              <label>
                Modelo:{' '}
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">— escolha —</option>
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <input placeholder="público-alvo (opcional), ex.: diretoria" value={audience} onChange={(e) => setAudience(e.target.value)} style={{ minWidth: 240 }} />
            <label>
              Visibilidade:{' '}
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
                <option value="public">Pública (políticas PII aplicam)</option>
                <option value="internal">Interna</option>
              </select>
            </label>
            <button className="publish-app" disabled={!aiEnabled || busy || !request.trim() || (models.length > 1 && !model)} onClick={() => propor()}>
              {busy ? 'Planejando…' : '✨ Propor plano'}
            </button>
          </div>
          {erro && <div className="error" style={{ marginTop: 10 }}>{erro}</div>}
        </div>
      )}

      {plan && (
        <div className="ra-plan">
          <h2>
            {plan.title} <span className="muted small">· catálogo {plan.catalog} · {plan.visibility}</span>
          </h2>
          {plan.purpose && <p className="muted">{plan.purpose}</p>}
          {(plan.warnings || []).filter(Boolean).map((w, i) => (
            <div key={i} className="ra-warn">⚠ {w}</div>
          ))}
          {errors.map((e, i) => (
            <div key={i} className={errosAtivos.includes(e) ? 'error' : 'muted small'}>
              <b className="mono">{e.path}</b>: {e.message}
              {!errosAtivos.includes(e) && ' (resolvido pelo descarte)'}
            </div>
          ))}

          {plan.pages.map((pg) => (
            <div key={pg.path} className={'ra-page' + (descartes.has(pg.path) ? ' off' : '')}>
              <div className="ra-page-head">
                <label>
                  <input type="checkbox" checked={!descartes.has(pg.path)} onChange={() => toggle(pg.path)} />
                  <b>{pg.title}</b> <span className="mono small muted">{pg.path}</span>
                  {pg.parameter && <span className="pj-badge">por {pg.parameter.dimension}</span>}
                </label>
              </div>
              {pg.blocks.map((b, i) => (
                <div key={i} className={'ra-block' + (descartes.has(pg.path + '#' + i) ? ' off' : '')}>
                  <label>
                    <input type="checkbox" checked={!descartes.has(pg.path + '#' + i)} onChange={() => toggle(pg.path + '#' + i)} />
                    <span className="nb-vb-style">{b.style}</span> {b.title && <b>{b.title}</b>}
                  </label>
                  <div className="ra-chips">
                    {b.metrics.map((m) => (
                      <span key={m} className="param-chip on">Σ {m}</span>
                    ))}
                    {(b.dims || []).map((d, j) => (
                      <span key={j} className="param-chip">{d.dim}{d.level ? '.' + d.level : ''}</span>
                    ))}
                    {(b.filters || []).map((f, j) => (
                      <span key={j} className="param-chip ra-filter">{f.dim}{f.level ? '.' + f.level : ''} = {(f.values || []).join(', ')}</span>
                    ))}
                  </div>
                  {b.explanation && <div className="muted small">{b.explanation}</div>}
                </div>
              ))}
            </div>
          ))}

          <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="publish-app" disabled={busy || errosAtivos.length > 0 || !efetivo?.pages.length} onClick={gerar}
              title={errosAtivos.length ? 'corrija o plano (↻ Regerar) ou descarte os itens inválidos — plano inválido nunca é consertado em silêncio' : ''}>
              {busy ? 'Gerando…' : '⚡ Gerar ' + (efetivo?.pages.length || 0) + ' página(s)'}
            </button>
            <input placeholder='ajuste para regerar, ex.: "troque o mapa por tabela"' value={nota} onChange={(e) => setNota(e.target.value)} style={{ minWidth: 280 }} />
            <button disabled={busy} onClick={() => propor(nota || undefined)}>↻ Regerar</button>
            <button disabled={busy} onClick={() => (setPlan(null), setErrors([]))}>← Objetivo</button>
          </div>
          {erro && <div className="error" style={{ marginTop: 10 }}>{erro}</div>}
        </div>
      )}
    </div>
  );
}

/** Porta de entrada do "Novo relatório": ✨ completo | bloco a bloco (D23). */
export default function NewReport() {
  const { project = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const mode = search.get('mode');
  if (search.get('edit') || mode === 'blocks') return <Wizard />; // reedição e wizard intactos
  if (mode === 'ai') return <ReportAgent project={project} />;
  return (
    <div className="page">
      <h1>Novo relatório</h1>
      <div className="ra-doors">
        <button className="ra-door" onClick={() => setSearch({ mode: 'ai' })}>
          <span className="ra-door-icon">✨</span>
          <b>Descrever relatório completo</b>
          <span className="muted small">Você descreve em português; a IA planeja páginas e blocos sobre o catálogo semântico; você revisa e gera tudo de uma vez.</span>
        </button>
        <button className="ra-door" onClick={() => setSearch({ mode: 'blocks' })}>
          <span className="ra-door-icon">▣</span>
          <b>Montar bloco a bloco</b>
          <span className="muted small">O wizard de 4 passos de sempre: Fonte → Seleção → Argumentos → Apresentação.</span>
        </button>
      </div>
    </div>
  );
}
