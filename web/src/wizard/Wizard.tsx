import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { jget, jput, runQuery } from '../api';
import { alertDialog, promptDialog } from '../components/dialogs';
import { buildModel } from '../builder/infer';
import { defaultPageName } from '../builder/evidencePage';
import type { Selections, SourceInfo, VbParam } from '../builder/types';
import { EMPTY_SEL } from '../builder/types';
import { findViewblocks, spliceViewblock } from '../../../shared/viewblock.js';
import { styleById } from '../../../shared/viewStyles.js';
import Step1Source from './Step1Source';
import Step2Select from './Step2Select';
import Step2Catalog from './Step2Catalog';
import Step3Params from './Step3Params';
import Step4Style from './Step4Style';
import { CatSel, WizardSource, compileFromState, compileSemanticFromState, catSelFromMeta, stateFromMeta } from './vbState';
import { dimAliasOf } from '../../../shared/semanticCompile.js';

const STEPS = ['Fonte', 'Seleção', 'Argumentos', 'Apresentação'];

// Wizard "Novo relatório" (spec §5, ordem DataWindow): Fonte → Seleção →
// Argumentos → Apresentação. Também REEDITA um View Block existente
// (?edit=<vbId>&page=<path>&step=<n>): recarrega o estado do marcador e
// regrava só o bloco via spliceViewblock.
export default function Wizard() {
  const { project = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const editId = search.get('edit');
  const editPage = search.get('page') || '';

  const [step, setStep] = useState(1);
  const [source, setSource] = useState<WizardSource | null>(null);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [sel, setSel] = useState<Selections>(EMPTY_SEL);
  const [params, setParams] = useState<VbParam[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [pivot, setPivot] = useState<any>(null);
  const [nested, setNested] = useState<any>(null);
  // Fonte semântica (F3): catálogo carregado + seleção por NOMES do modelo.
  const [catalog, setCatalog] = useState<any>(null);
  const [catalogHash, setCatalogHash] = useState('');
  const [catSel, setCatSel] = useState<CatSel>({ metrics: [], dims: [] });
  // filtros no shape do catálogo (drill fixado F4 G) — preservados na reedição
  const [semFilters, setSemFilters] = useState<any[]>([]);
  const [loading, setLoading] = useState(!!editId);
  const [err, setErr] = useState('');

  // Colunas da fonte: listagem (source), describe do SQL (query/model) ou,
  // na fonte SEMÂNTICA, as colunas do FATO do modelo (p/ hierarchy/derivações).
  async function resolveSourceInfo(s: WizardSource): Promise<{ info: SourceInfo | null; cat?: any }> {
    if (s.kind === 'semantic') {
      const d = await jget('/projects/' + project + '/semantic');
      const m = (d.models || []).find((x: any) => x.model === s.name && x.valid);
      if (!m) return { info: null };
      const srcs = await jget('/projects/' + project + '/sources');
      const fact = (srcs.sources || []).find((x: SourceInfo) => x.name === m.catalog.fact);
      if (!fact) return { info: null, cat: m }; // fato não registrado no projeto
      return { info: { name: m.catalog.fact, columns: fact.columns }, cat: m };
    }
    if (s.kind === 'source') {
      const d = await jget('/projects/' + project + '/sources');
      return { info: (d.sources || []).find((x: SourceInfo) => x.name === s.name) || null };
    }
    const sql = String(s.sql || '').trim().replace(/;\s*$/, '');
    const r = await runQuery('describe select * from (\n' + sql + '\n) t', project);
    if (r.error || !r.rows) return { info: null };
    return { info: { name: s.name, columns: r.rows.map((row: any) => ({ name: String(row.column_name), type: String(row.column_type) })) } };
  }

  async function pickSource(s: WizardSource) {
    setErr('');
    const { info, cat } = await resolveSourceInfo(s);
    if (!info) {
      setErr(
        s.kind === 'semantic'
          ? `A fonte-fato do modelo não está registrada no projeto — suba/registre "${cat?.catalog?.fact || '?'}" em Dados › Fontes.`
          : 'Não consegui ler as colunas da fonte (a query roda?).'
      );
      return;
    }
    setSource(s);
    setSourceInfo(info);
    setCatalog(cat ? cat.catalog : null);
    setCatalogHash(cat ? cat.hash : '');
    if (!editId) {
      setSel(EMPTY_SEL); // fonte nova zera a seleção (mesma regra do builder)
      setCatSel({ metrics: [], dims: [] });
      setParams([]);
      setStyle(null);
      setRoles({});
      setPivot(null);
      setNested(null);
    }
  }

  // Modo reedição: reconstrói o estado a partir do marcador da página.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      const d = await jget('/projects/' + project + '/file?path=' + encodeURIComponent(editPage));
      const meta = findById(findViewblocks(d.content || ''), editId);
      if (!meta) {
        await alertDialog('View Block não encontrado na página (foi desacoplado?).');
        navigate('/projects/' + project);
        return;
      }
      const st = stateFromMeta(meta);
      let s: WizardSource = st.source;
      if (s.kind === 'query' && s.ref) {
        const f = await jget('/projects/' + project + '/query-file?path=' + encodeURIComponent(s.ref));
        s = { ...s, sql: f.content || '' };
      } else if (s.kind === 'model' && s.ref) {
        const m = await jget('/projects/' + project + '/models');
        s = { ...s, sql: (m.models || []).find((x: any) => x.id === s.ref)?.sql || '' };
      }
      const { info, cat } = await resolveSourceInfo(s);
      setSource(s);
      setSourceInfo(info);
      setCatalog(cat ? cat.catalog : null);
      setCatalogHash(cat ? cat.hash : '');
      if (s.kind === 'semantic') {
        setCatSel(catSelFromMeta(meta));
        setSemFilters(meta.filters || []);
      }
      setSel(st.sel);
      setParams(st.params);
      setStyle(st.style);
      setRoles(st.roles || {});
      setPivot(st.pivot || null);
      setNested(st.nested || null);
      setStep(Math.min(4, Math.max(2, Number(search.get('step')) || 4)));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, editPage, project]);

  // Modelo do canvas: fonte de arquivo enxerga as demais fontes do projeto
  // (joins inferidos); query/model operam isoladas (CTE).
  const [allSources, setAllSources] = useState<SourceInfo[]>([]);
  useEffect(() => {
    jget('/projects/' + project + '/sources').then((d) => setAllSources(d.sources || []));
  }, [project]);
  const model = useMemo(() => {
    if (!source || !sourceInfo) return null;
    return source.kind === 'source' ? buildModel(allSources, source.name) : buildModel([sourceInfo], sourceInfo.name);
  }, [source, sourceInfo, allSources]);

  const isSemantic = source?.kind === 'semantic';
  const vbDraft = useMemo(() => {
    if (isSemantic && catalog) {
      // shapes com alias — os contratos dos estilos (requires) funcionam igual
      return {
        dims: catSel.dims.map((s) => ({ dim: s.dim, level: s.level, alias: dimAliasOf(catalog, s), column: dimAliasOf(catalog, s), table: catalog.fact })),
        metrics: catSel.metrics.map((n) => ({ name: n, alias: n, column: n })),
        params,
        roles,
        pivot,
        nested,
        source: { kind: 'semantic', name: catalog.model },
      };
    }
    return { dims: sel.groupBy, metrics: sel.measures, params, roles, pivot, nested, source: source ? { kind: source.kind, name: source.name } : null };
  }, [isSemantic, catalog, catSel, sel, params, roles, pivot, nested, source]);

  // Estilos com papéis dispensam a seleção do canvas — o gating fica no Passo 4.
  const styleOk = !!style && !!sourceInfo && !!styleById(style)?.requires(vbDraft, sourceInfo).ok;
  const canNext = step === 1 ? !!sourceInfo : step === 2 ? true : step === 3 ? true : styleOk;

  async function finish() {
    if (!source || !sourceInfo || !style || !styleOk) return;
    if (!isSemantic && !model) return;
    let block: string;
    try {
      block = isSemantic
        ? compileSemanticFromState({ source, sourceInfo, catSel, params, style, filters: semFilters, roles, pivot, nested, vbId: editId || undefined }, catalog, catalogHash)
        : compileFromState({ source, sourceInfo, sel, params, style, roles, pivot, nested, vbId: editId || undefined }, model!);
    } catch (e: any) {
      setErr(String(e.message || e));
      return;
    }
    if (editId) {
      const d = await jget('/projects/' + project + '/file?path=' + encodeURIComponent(editPage));
      const next = spliceViewblock(d.content || '', editId, block);
      const rw = await jput('/projects/' + project + '/file', { path: editPage, content: next });
      if (rw?.error) {
        setErr(rw.error); // transação página↔spec desfeita no server
        return;
      }
      localStorage.setItem('studio.file.' + project, editPage);
      navigate('/projects/' + project);
      return;
    }
    const firstDim = isSemantic ? catSel.dims[0]?.dim : sel.groupBy[0]?.column;
    const defName = isSemantic
      ? `${catalog.model}${firstDim ? '_por_' + firstDim : ''}`.toLowerCase()
      : defaultPageName(model!, sel);
    const name = await promptDialog('Nome da página (.md):', {
      title: 'Gerar relatório em ' + project,
      defaultValue: defName,
    });
    if (!name) return;
    const path = (name.endsWith('.md') ? name : name + '.md').replace(/[^a-zA-Z0-9_/.\-\[\]]/g, '_');
    const base = isSemantic ? catalog.label || catalog.model : source.name;
    const titulo = firstDim ? `${base} por ${firstDim}` : `Relatório de ${base}`;
    const content = `# ${titulo}\n\n${block}\n`;
    await jput('/projects/' + project + '/file', { path, content });
    localStorage.setItem('studio.file.' + project, path);
    navigate('/projects/' + project);
  }

  if (loading) return <div className="page muted">Carregando o View Block…</div>;

  return (
    <div className="page wiz">
      <h1>▣ {editId ? 'Reeditar View Block' : 'Novo relatório'}</h1>
      <div className="wiz-steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={'wiz-tab' + (step === i + 1 ? ' active' : '') + (i + 1 > step && !canJump(i + 1) ? ' off' : '')}
            disabled={i + 1 > step && !canJump(i + 1)}
            onClick={() => setStep(i + 1)}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {step === 1 && <Step1Source project={project} selected={source} onSelect={pickSource} />}
      {step === 2 && isSemantic && catalog && <Step2Catalog catalog={catalog} catSel={catSel} onChange={setCatSel} project={project} />}
      {step === 2 && !isSemantic && model && <Step2Select project={project} model={model} sel={sel} onChange={setSel} />}
      {step === 2 && !isSemantic && !model && <div className="muted">Escolha uma fonte no Passo 1.</div>}
      {step === 3 && sourceInfo && (
        <Step3Params
          sourceInfo={sourceInfo}
          params={params}
          onChange={setParams}
          fromOptions={
            isSemantic && catalog
              ? Object.entries(catalog.dimensions || {}).flatMap(([n, d]: [string, any]) =>
                  Array.isArray(d.hierarchy) ? d.hierarchy.map((lv: string) => `${n}.${lv}`) : [n]
                )
              : undefined
          }
        />
      )}
      {step === 4 && sourceInfo && source && (
        <Step4Style
          project={project}
          source={source}
          vbDraft={vbDraft}
          sourceInfo={sourceInfo}
          style={style}
          roles={roles}
          pivot={pivot}
          nested={nested}
          dimAliases={vbDraft.dims.map((d: any) => d.alias || d.column)}
          onSelect={setStyle}
          onRoles={setRoles}
          onPivot={setPivot}
          onNested={setNested}
        />
      )}

      <div className="wiz-nav">
        {step > 1 && <button onClick={() => setStep(step - 1)}>← Voltar</button>}
        <div className="nb-spacer" />
        {step < 4 && (
          <button className="run" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Avançar →
          </button>
        )}
        {step === 4 && (
          <button className="run" disabled={!styleOk} onClick={finish} title={styleOk ? '' : 'Escolha um estilo cujo contrato esteja atendido'}>
            {editId ? '▣ Regravar bloco' : '▣ Gerar relatório'}
          </button>
        )}
      </div>
    </div>
  );

  function canJump(target: number) {
    if (target <= step) return true;
    return !!sourceInfo; // estilos com papéis dispensam seleção — Passo 4 é quem gate-ia
  }
}

function findById(list: any[], id: string): any {
  for (const n of list) {
    if (n.meta?.id === id) return n.meta;
    const c = findById(n.children || [], id);
    if (c) return c;
  }
  return null;
}
