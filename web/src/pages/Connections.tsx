import { useCallback, useEffect, useState } from 'react';
import { jget, jput, jdel, jpost } from '../api';
import { alertDialog, confirmDialog, formDialog, promptDialog } from '../components/dialogs';

type Conn = {
  name: string;
  type: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  path?: string;
  hasSecret: boolean;
  usage: { project: string; sources: string[] }[];
};

// Menu global "Conexões" (DELTA §2) — nível da instalação, espaço do ARQUITETO.
// Cadastrada uma vez, reusada por N projetos. Senha é write-only: entra e
// nunca é exibida de volta (só substituível).
export default function Connections() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [testing, setTesting] = useState('');
  const load = useCallback(() => jget('/connections').then((d) => setConns(d.connections || [])), []);
  useEffect(() => {
    load();
  }, [load]);

  async function editar(existing?: Conn) {
    const v = await formDialog({
      title: existing ? `Editar conexão ${existing.name}` : 'Nova conexão global',
      message: 'Sem segredos aqui — a senha entra depois, em "🔑 Senha" (write-only).',
      confirmLabel: 'Salvar',
      fields: [
        { name: 'name', label: 'Nome (referenciado pelos projetos)', value: existing?.name || '', placeholder: 'dw_producao' },
        {
          name: 'type',
          label: 'Tipo',
          type: 'select',
          value: existing?.type || 'postgres',
          options: [{ value: 'postgres' }, { value: 'mysql' }, { value: 'sqlite' }, { value: 'duckdb' }],
        },
        { name: 'host', label: 'Host (ou path p/ duckdb)', value: existing?.host || existing?.path || '', placeholder: 'db.exemplo.com' },
        { name: 'database', label: 'Database · user (db/user)', value: [existing?.database, existing?.user].filter(Boolean).join('/'), placeholder: 'vendas/leitura' },
      ],
    });
    if (!v || !v.name) return;
    const [database, user] = String(v.database || '').split('/');
    const body =
      v.type === 'duckdb'
        ? { type: v.type, path: v.host }
        : { type: v.type, host: v.host, database: database || undefined, user: user || undefined };
    const r = await jput('/connections/' + encodeURIComponent(v.name), body);
    if (r.errors?.length) {
      alertDialog(r.errors.map((e: any) => `${e.path}: ${e.message}`).join('\n'));
      return;
    }
    load();
  }

  async function senha(c: Conn) {
    const value = await promptDialog(
      `Senha da conexão "${c.name}" — SÓ a senha (host/porta/database/usuário vêm do cadastro). ` +
        `Alternativa: uma connection string completa (postgres://user:senha@host/db). Nunca é exibida de volta.`,
      { title: '🔑 ' + c.name, placeholder: 'senha' }
    );
    if (!value) return;
    await jput('/connections/' + encodeURIComponent(c.name) + '/secret', { value });
    alertDialog('Credencial gravada (write-only).');
    load();
  }

  async function testar(c: Conn) {
    setTesting(c.name);
    const r = await jpost('/connections/' + encodeURIComponent(c.name) + '/test', {});
    setTesting('');
    alertDialog(r.ok ? `✓ Conexão "${c.name}" OK` : `✕ Falhou: ${r.error}`, 'Testar conexão');
  }

  async function excluir(c: Conn) {
    // DELTA §2: varre TODOS os project.yaml e exibe projeto → fontes antes.
    const { usage } = await jget('/connections/' + encodeURIComponent(c.name) + '/usage');
    const deps = (usage || []).map((u: any) => `• ${u.project} → ${u.sources.join(', ')}`).join('\n');
    const msg = deps
      ? `A conexão "${c.name}" está EM USO:\n\n${deps}\n\nEssas fontes deixarão de atualizar (↻ falhará com erro claro). Excluir mesmo assim?`
      : `Excluir a conexão "${c.name}"? (nenhum projeto depende dela)`;
    if (!(await confirmDialog(msg, { title: 'Excluir conexão', confirmLabel: 'Excluir', danger: true }))) return;
    await jdel('/connections/' + encodeURIComponent(c.name));
    load();
  }

  return (
    <div className="page">
      <h1>⇌ Conexões</h1>
      <p className="muted">
        Registro GLOBAL (nível da instalação, espaço do arquiteto): cadastre uma vez, use em N projetos. Os projetos referenciam pelo
        nome — export/clone leva só o nome, nunca a credencial.
      </p>
      <button className="run" onClick={() => editar()}>
        ＋ Nova conexão
      </button>

      <div className="pj-grid" style={{ marginTop: 16 }}>
        {conns.map((c) => (
          <div key={c.name} className="pj-card" style={{ cursor: 'default' }}>
            <div className="pj-head">
              <span className="pj-name">{c.name}</span>
              <span className="pj-badge">{c.type}</span>
              {c.hasSecret ? <span className="conn-badge view">🔑</span> : c.type !== 'duckdb' && <span className="pj-badge" title="senha ainda não gravada">sem senha</span>}
            </div>
            <div className="pj-meta">
              {c.type === 'duckdb' ? c.path : [c.host, c.database, c.user && '@' + c.user].filter(Boolean).join(' · ')}
            </div>
            <div className="pj-meta">
              {c.usage.length
                ? 'em uso: ' + c.usage.map((u) => `${u.project} (${u.sources.length})`).join(', ')
                : 'sem uso ainda'}
            </div>
            <div className="pj-actions">
              <button onClick={() => testar(c)} disabled={testing === c.name}>
                {testing === c.name ? 'Testando…' : 'Testar'}
              </button>
              <button onClick={() => senha(c)}>🔑 Senha</button>
              <button onClick={() => editar(c)}>Editar</button>
              <button className="danger" onClick={() => excluir(c)}>
                Excluir
              </button>
            </div>
          </div>
        ))}
        {conns.length === 0 && <div className="muted">Nenhuma conexão — os projetos seguem funcionando com arquivos e mounts.</div>}
      </div>
    </div>
  );
}
