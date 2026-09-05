import { useEffect, useState } from 'react';
import { jget, jput } from '../api';
import { alertDialog } from '../components/dialogs';

export default function Settings({ onSaved }: { onSaved: (s: any) => void }) {
  const [s, setS] = useState<any>(null);
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    jget('/settings').then((d) => (d.error ? setLoadErr(d.error) : setS(d)));
  }, []);
  if (loadErr) return <div className="page"><div className="error">{loadErr}</div></div>;
  if (!s) return <div className="page">Carregando...</div>;
  const t = s.theme;
  const ai = s.ai || { provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', apiKey: '' };
  const deploy = s.deploy || { dir: 'published' };
  const setTheme = (k: string, v: any) => setS({ ...s, theme: { ...s.theme, [k]: v } });
  const setAi = (k: string, v: any) => setS({ ...s, ai: { ...ai, [k]: v } });
  const setDeploy = (k: string, v: any) => setS({ ...s, deploy: { ...deploy, [k]: v } });
  const localProvider = ai.provider !== 'anthropic';

  async function save() {
    const r = await jput('/settings', s);
    if (r.error) {
      alertDialog('Erro ao salvar: ' + r.error);
      return;
    }
    onSaved(r);
    alertDialog('Configurações salvas!');
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="panel">
        <h3>Organization</h3>
        <label>
          Nome
          <input
            value={s.organization.name}
            onChange={(e) => setS({ ...s, organization: { ...s.organization, name: e.target.value } })}
          />
        </label>
        <label>
          Separador decimal
          <select
            value={s.organization.decimalSeparator}
            onChange={(e) => setS({ ...s, organization: { ...s.organization, decimalSeparator: e.target.value } })}
          >
            <option value=",">vírgula (,)</option>
            <option value=".">ponto (.)</option>
          </select>
        </label>
      </div>
      <div className="panel">
        <h3>Theme</h3>
        <label>
          Modo
          <select value={t.mode} onChange={(e) => setTheme('mode', e.target.value)}>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </label>
        <label>
          Fundo <input type="color" value={t.background} onChange={(e) => setTheme('background', e.target.value)} />
        </label>
        <label>
          Card <input type="color" value={t.card} onChange={(e) => setTheme('card', e.target.value)} />
        </label>
        <label>
          Primária <input type="color" value={t.primary} onChange={(e) => setTheme('primary', e.target.value)} />
        </label>
        <div style={{ marginTop: 12 }}>
          <div className="muted">Paleta de gráficos</div>
          <div className="row">
            {t.chartPalette.map((c: string, i: number) => (
              <input
                key={i}
                type="color"
                value={c}
                onChange={(e) => {
                  const p = [...t.chartPalette];
                  p[i] = e.target.value;
                  setTheme('chartPalette', p);
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="panel">
        <h3>Agente (IA)</h3>
        <p className="muted">
          Backend do agente (Home e SQL Console). Use um servidor local OpenAI-compatível (LM Studio, vLLM, LiteLLM)
          ou a Anthropic. A chave fica só no servidor.
        </p>
        <label>
          Provedor
          <select value={ai.provider} onChange={(e) => setAi('provider', e.target.value)}>
            <option value="openai">Local — OpenAI-compatível (LM Studio / vLLM / LiteLLM)</option>
            <option value="anthropic">Anthropic (Claude API)</option>
          </select>
        </label>
        {localProvider && (
          <label>
            Base URL
            <input
              style={{ width: 320 }}
              value={ai.baseUrl || ''}
              placeholder="http://localhost:1234/v1"
              onChange={(e) => setAi('baseUrl', e.target.value)}
            />
          </label>
        )}
        <label>
          Modelo
          <input
            style={{ width: 320 }}
            value={ai.model || ''}
            placeholder={localProvider ? 'nome do modelo carregado no servidor' : 'claude-opus-4-8'}
            onChange={(e) => setAi('model', e.target.value)}
          />
        </label>
        <label>
          Chave de API {localProvider && <span className="muted small">(opcional em servidores locais)</span>}
          <input
            type="password"
            style={{ width: 320 }}
            value={ai.apiKey || ''}
            placeholder={localProvider ? 'em branco para local' : 'sk-ant-… ou via ANTHROPIC_API_KEY'}
            onChange={(e) => setAi('apiKey', e.target.value)}
          />
        </label>
        {localProvider && (
          <label title="Envia reasoning_effort=low e enable_thinking=false; servidores/modelos que não suportam ignoram.">
            <input
              type="checkbox"
              checked={Boolean(ai.noThink)}
              onChange={(e) => setAi('noThink', e.target.checked)}
              style={{ width: 'auto' }}
            />
            Desligar raciocínio (economiza tokens em modelos <i>reasoning</i>)
          </label>
        )}
      </div>
      <div className="panel">
        <h3>Deploy</h3>
        <p className="muted">
          Onde os relatórios publicados (📦 Publish e ☁ Publish app) são gravados no servidor. Caminho relativo
          fica sob a raiz da console; caminho absoluto aponta para uma pasta do Evidence on-premise ou um mount.
        </p>
        <label>
          Pasta de deploy
          <input
            style={{ width: 360 }}
            value={deploy.dir || ''}
            placeholder="published"
            onChange={(e) => setDeploy('dir', e.target.value)}
          />
        </label>
        <div className="muted small">Ex.: <code>published</code> · <code>D:\evidence\pages</code> · <code>/mnt/reports</code></div>
      </div>
      <button className="run" onClick={save}>
        Salvar
      </button>
    </div>
  );
}
