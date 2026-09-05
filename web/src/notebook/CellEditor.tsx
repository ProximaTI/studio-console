import { useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { markdown as mdLang } from '@codemirror/lang-markdown';
import { Prec } from '@codemirror/state';
import { Cell } from './cells';

// Editor CodeMirror de uma célula (SQL/Texto/Raw), com atalhos de execução
// (Ctrl/Cmd+Enter e Shift+Enter, hábito Jupyter) e rastreio de foco/cursor —
// o Notebook usa a view reportada para inserir parâmetros e conteúdo do agente.
export default function CellEditor({
  cell,
  onChange,
  onRun,
  onBlurText,
  onFocusEditor,
  onView,
  readOnly = false,
}: {
  cell: Cell;
  onChange: (v: string) => void;
  onRun: () => void;
  onBlurText: () => void;
  onFocusEditor: (view: EditorView) => void;
  onView?: (view: EditorView) => void;
  /** Célula dentro de um View Block: visível, executável, mas não editável. */
  readOnly?: boolean;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const runKey = Prec.highest(
    keymap.of([
      { key: 'Mod-Enter', run: () => (onRun(), true) },
      { key: 'Shift-Enter', run: () => (onRun(), true) },
    ])
  );
  const focusWatcher = EditorView.updateListener.of((u) => {
    if (u.focusChanged && u.view.hasFocus) onFocusEditor(u.view);
  });
  const ext =
    cell.type === 'sql'
      ? [sqlLang(), runKey, focusWatcher]
      : cell.type === 'text'
      ? [mdLang(), runKey, focusWatcher]
      : [runKey, focusWatcher];
  return (
    <div
      className="nb-editor"
      onBlur={cell.type === 'text' ? onBlurText : undefined}
      onMouseDown={() => viewRef.current && onFocusEditor(viewRef.current)}
    >
      <CodeMirror
        value={cell.source}
        height="auto"
        minHeight="44px"
        theme={document.body.dataset.mode === 'dark' ? 'dark' : 'light'}
        extensions={ext}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          onView?.(view);
        }}
        basicSetup={{ lineNumbers: cell.type === 'sql' }}
        autoFocus={cell.type === 'text'}
      />
    </div>
  );
}
