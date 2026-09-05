import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

// Editor SQL com numeração de linhas (padrão) e atalho Ctrl/Cmd+Enter para rodar.
export default function SqlEditor({
  value,
  onChange,
  onRun,
  height = '200px',
}: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  height?: string;
}) {
  const runKey = Prec.highest(
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          onRun?.();
          return true;
        },
      },
    ])
  );
  const theme = document.body.dataset.mode === 'dark' ? 'dark' : 'light';
  return <CodeMirror value={value} height={height} theme={theme} extensions={[sql(), runKey]} onChange={onChange} />;
}
