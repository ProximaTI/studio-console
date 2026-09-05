import { useCallback, useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { jget, jput, jdel, jpost } from '../api';
import { alertDialog, confirmDialog, formDialog, promptDialog } from '../components/dialogs';

type ModelInfo = { file: string; model: string; label: string; valid: boolean; errors: { path: string; message: string }[]; hash: string };

// Painel "Semântica" (espaço do ARQUITETO — F3 §2): edita semantic/*.yaml com
// validação no save (erros inline). Modelos válidos viram fonte no Passo 1.
export default function SemanticPanel({ project }: { project: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [active, setActive] = useState('');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(true);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [notice, setNotice] = useState('');
  const base = '/projects/' + project + '/semantic';

  const load = useCallback(() => jget(base).then((d) => setModels(d.models || [])), [base]);
  useEffect(() => {
    load();
  }, [load]);

  async function open(file: string) {
    const d = await jget(base + '/file?path=' + encodeURIComponent(file));
    setActive(file);
    setContent(d.content || '');
    setSaved(true);
    setErrors(models.find((m) => m.file === file)?.errors || []);
  }

  async function save() {
    const r = await jput(base + '/file', { path: active, content });
    setErrors(r.errors || []);
    setNotice(r.notice || '');
    setSaved(true);
    load();
  }

  async function novo() {
    const name = await promptDialog('Nome do modelo (vira semantic/<nome>.yaml):', { title: 'Novo modelo semântico', placeholder: 'vendas' });
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const draft = `model: ${slug}\nlabel: "${name}"\nfact: <fonte_do_projeto>\ngrain: []\n\ndimensions: {}\n\nmetrics: {}\n`;
    await jput(base + '/file', { path: slug + '.yaml', content: draft });
    await load();
    open(slug + '.yaml');
  }

  // Bootstrap (§3.4): a heurística vira GERADOR DE RASCUNHO — roda uma vez e
  // emite YAML para revisão do arquiteto; depois o compilador só usa o declarado.
  async function bootstrap() {
    const srcs = (await jget('/projects/' + project + '/sources')).sources || [];
    if (!srcs.length) return;
    const v = await formDialog({
      title: 'Gerar rascunho do modelo',
      message: 'Roda a heurística de medidas/dimensões UMA vez e emite o YAML para revisão.',
      confirmLabel: 'Gerar rascunho',
      fields: [{ name: 'fact', label: 'Fonte-fato', type: 'select', options: srcs.map((s: any) => ({ value: s.name })) }],
    });
    if (!v) return;
    const src = srcs.find((s: any) => s.name === v.fact);
    const NUM = /INT|DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC/i;
    const KEY = /(_id|_code|_key)$|^id$/i;
    const TIME = /(^|_)(data|date)($|_)/i;
    const dims: string[] = [];
    const mets: string[] = [];
    for (const c of src.columns) {
      if (NUM.test(c.type) && !KEY.test(c.name) && !/^ano$/i.test(c.name)) {
        mets.push(`  ${c.name}_total: { agg: sum, column: ${c.name}, label: "${c.name}",`);
        mets.push(`    description: "Soma de ${c.name} no recorte (rascunho — revise)" }`);
      } else if (TIME.test(c.name) || /DATE|TIMESTAMP/i.test(c.type)) {
        dims.push(`  tempo: { column: ${c.name}, hierarchy: [ano, trimestre, mes],`);
        dims.push(`    description: "Dimensão temporal sobre ${c.name}" }`);
      } else {
        dims.push(`  ${c.name}: { column: ${c.name}, description: "Valores de ${c.name} (rascunho — revise)" }`);
      }
    }
    const slug = String(v.fact).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const yaml = [
      `model: ${slug}`,
      `label: "${v.fact} (rascunho — revise antes de adotar)"`,
      `fact: ${v.fact}`,
      'grain: []',
      '',
      'dimensions:',
      ...dims,
      '',
      'metrics:',
      `  registros: { agg: count, column: ${src.columns[0]?.name || '*'}, label: "Registros", fmt: num0 }`,
      ...mets,
      '',
    ].join('\n');
    await jput(base + '/file', { path: slug + '.yaml', content: yaml });
    await load();
    open(slug + '.yaml');
  }

  // F4 frente H: sondas no DuckDB → propostas com EVIDÊNCIA → ratificação por
  // item → patch cirúrgico no YAML. Funciona sem LLM (redação determinística).
  async function sugerirRelacoes() {
    const m = models.find((x) => x.file === active);
    if (!m || !m.valid) {
      alertDialog('Abra um modelo VÁLIDO para sugerir relações.');
      return;
    }
    const r = await jpost(base + '/' + encodeURIComponent(m.model) + '/suggest-relations', {});
    if (r.error) {
      alertDialog(r.error, '✨ Sugerir relações');
      return;
    }
    const props = r.proposals || [];
    if (!props.length) {
      alertDialog('Nenhuma relação nova encontrada nas sondas (hierarquias já declaradas ou sem dependência funcional nos dados).', '✨ Sugerir relações');
      return;
    }
    const v = await formDialog({
      title: '✨ Relações inferidas dos DADOS (proposta, não fato)',
      message:
        `Sondas em ${r.totalLinhas} linhas de ${m.model}. Verdade na AMOSTRA atual — ratifique item a item; nada é gravado sem aceite.`,
      confirmLabel: 'Aplicar aceitos',
      fields: props.map((p: any, i: number) => ({
        name: 'p' + i,
        label: (p.kind === 'hierarchy' ? `hierarquia ${p.levels.join(' ▸ ')}` : `join ${p.join}: ${p.cardinality}`) + ` — ${p.evidence}`,
        type: 'select' as const,
        value: 'aceitar',
        options: [{ value: 'aceitar' }, { value: 'ignorar' }],
      })),
    });
    if (!v) return;
    const hierarchies: Record<string, string[]> = {};
    const cardinalities: any[] = [];
    props.forEach((p: any, i: number) => {
      if (v['p' + i] !== 'aceitar') return;
      if (p.kind === 'hierarchy') hierarchies[p.name] = p.levels;
      else cardinalities.push({ joinIndex: p.joinIndex, cardinality: p.cardinality });
    });
    if (!Object.keys(hierarchies).length && !cardinalities.length) return;
    const ap = await jpost(base + '/' + encodeURIComponent(m.model) + '/apply-relations', { hierarchies, cardinalities });
    if (ap.error) {
      alertDialog(ap.error);
      return;
    }
    await load();
    open(active); // recarrega o texto com o patch cirúrgico
  }

  async function excluir(file: string) {
    if (!(await confirmDialog(`Excluir o modelo ${file}? Páginas ancoradas nele não compilam mais.`, { confirmLabel: 'Excluir', danger: true }))) return;
    await jdel(base + '/file?path=' + encodeURIComponent(file));
    if (active === file) {
      setActive('');
      setContent('');
    }
    load();
  }

  return (
    <div className="sem">
      <aside className="sem-list">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Modelos · {models.length}</div>
        {models.map((m) => (
          <div key={m.file} className={'sem-item' + (m.file === active ? ' active' : '')} onClick={() => open(m.file)}>
            <span className={'sem-dot' + (m.valid ? ' ok' : ' bad')} title={m.valid ? 'válido' : m.errors.length + ' erro(s)'} />
            <div>
              <b>{m.label}</b>
              <div className="muted small mono">
                {m.file} · @{m.hash}
              </div>
            </div>
            <button className="conn-x" title="Excluir modelo" onClick={(e) => (e.stopPropagation(), excluir(m.file))}>
              ✕
            </button>
          </div>
        ))}
        {models.length === 0 && <div className="muted small">Nenhum modelo — o catálogo é opcional por construção.</div>}
        <button className="sb-newproj" style={{ marginTop: 10 }} onClick={novo}>
          ＋ Novo modelo
        </button>
        <button className="sb-newproj" style={{ marginTop: 6 }} onClick={bootstrap} title="Heurística roda UMA vez e vira YAML para revisão (§3.4)">
          ✨ Gerar rascunho do modelo
        </button>
        <button
          className="sb-newproj"
          style={{ marginTop: 6 }}
          onClick={sugerirRelacoes}
          disabled={!active}
          title="Sondas nos DADOS (dependência funcional + cardinalidade) propõem hierarquias de drill — você ratifica item a item (F4)"
        >
          ✨ Sugerir relações
        </button>
      </aside>

      <div className="sem-editor">
        {!active && <div className="muted" style={{ padding: 20 }}>Selecione um modelo (métricas e dimensões com rótulo/formato prontos para o analista).</div>}
        {active && (
          <>
            <div className="sem-bar">
              <span className="mono small">semantic/{active}</span>
              <div className="nb-spacer" />
              <button className="save" onClick={save}>
                {saved ? 'Salvo ✓' : 'Salvar *'}
              </button>
            </div>
            <CodeMirror
              value={content}
              height="440px"
              onChange={(v) => {
                setContent(v);
                setSaved(false);
              }}
              basicSetup={{ lineNumbers: true }}
            />
            {errors.length > 0 && (
              <div className="sem-errors">
                {errors.map((e, i) => (
                  <div key={i} className="error" style={{ marginTop: 6 }}>
                    <b className="mono">{e.path || '(raiz)'}</b>: {e.message}
                  </div>
                ))}
              </div>
            )}
            {notice && <p className="muted small">⚠ {notice}</p>}
            {errors.length === 0 && saved && <p className="muted small">✓ Válido — aparece como fonte no Passo 1 do wizard.</p>}
          </>
        )}
      </div>
    </div>
  );
}
