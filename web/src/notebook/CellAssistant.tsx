import { useState } from 'react';
import { jpost } from '../api';
import { Cell } from './cells';

// Painel ✨ do assistente de escrita por célula. Dono do próprio estado
// (texto do pedido, busy, erro); o Notebook só decide QUAL célula está com o
// painel aberto e COMO inserir o conteúdo gerado (cursor vs. substituição).
export default function CellAssistant({
  cell,
  schema,
  onInsert,
  onClose,
}: {
  cell: Cell;
  schema: { tables: any[]; queries: (string | undefined)[]; params: string[] };
  onInsert: (content: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function generate() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    const r = await jpost('/ai/cell', { cellType: cell.type, request: text, schema });
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    const content = String(r.content || '').trim();
    if (!content) {
      setErr('O agente não retornou conteúdo.');
      return;
    }
    onInsert(content);
  }

  return (
    <div className="nb-ai">
      <div className="nb-ai-head">
        ✨ Agente <span className="muted small">· {cell.type.toUpperCase()}</span>
      </div>
      <textarea
        className="nb-ai-input"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            generate();
          }
        }}
        placeholder={
          cell.type === 'sql'
            ? 'ex.: soma de valor por profissional, top 10'
            : cell.type === 'raw'
            ? 'ex.: gráfico de barras de faturamento por mês'
            : 'ex.: parágrafo resumindo o total do período'
        }
      />
      <div className="nb-ai-actions">
        <button className="run" onClick={generate} disabled={busy || !text.trim()}>
          {busy ? 'Gerando…' : 'Gerar ⌘⏎'}
        </button>
        <button onClick={onClose}>Fechar</button>
      </div>
      {err && <div className="error nb-ai-err">{err}</div>}
      <div className="muted small">Insere no cursor — ou substitui se a célula estiver vazia.</div>
    </div>
  );
}
