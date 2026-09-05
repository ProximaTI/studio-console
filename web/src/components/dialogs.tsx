import { FormEvent, useEffect, useState } from 'react';

// Diálogos da console no lugar de alert()/confirm()/prompt() nativos.
// API imperativa com Promises — a troca nos call sites é mecânica:
//   if (!confirm(x))            ->  if (!(await confirmDialog(x)))
//   const v = prompt(x, def)    ->  const v = await promptDialog(x, { defaultValue: def })
// formDialog cobre fluxos de vários campos (ex.: projeto + nome de arquivo).
// <DialogHost/> é montado UMA vez no App; chamadas enfileiram (um por vez).

export type FormField = {
  name: string;
  label: string;
  type?: 'text' | 'select';
  options?: { value: string; label?: string }[];
  value?: string;
  placeholder?: string;
  hint?: string;
};

type Spec =
  | { kind: 'alert'; id: number; message: string; title?: string; resolve: () => void }
  | { kind: 'confirm'; id: number; message: string; title?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; id: number; message: string; title?: string; defaultValue?: string; placeholder?: string; resolve: (v: string | null) => void }
  | { kind: 'form'; id: number; title: string; message?: string; fields: FormField[]; confirmLabel?: string; resolve: (v: Record<string, string> | null) => void };

let nextId = 1;
let enqueue: (s: Spec) => void = () => {
  throw new Error('DialogHost não está montado — adicione <DialogHost/> no App.');
};

export const alertDialog = (message: string, title?: string) =>
  new Promise<void>((resolve) => enqueue({ kind: 'alert', id: nextId++, message, title, resolve }));

export const confirmDialog = (message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}) =>
  new Promise<boolean>((resolve) => enqueue({ kind: 'confirm', id: nextId++, message, ...opts, resolve }));

export const promptDialog = (message: string, opts: { title?: string; defaultValue?: string; placeholder?: string } = {}) =>
  new Promise<string | null>((resolve) => enqueue({ kind: 'prompt', id: nextId++, message, ...opts, resolve }));

export const formDialog = (spec: { title: string; message?: string; fields: FormField[]; confirmLabel?: string }) =>
  new Promise<Record<string, string> | null>((resolve) => enqueue({ kind: 'form', id: nextId++, ...spec, resolve }));

export function DialogHost() {
  const [queue, setQueue] = useState<Spec[]>([]);
  useEffect(() => {
    enqueue = (s) => setQueue((q) => [...q, s]);
    return () => {
      enqueue = () => {
        throw new Error('DialogHost não está montado — adicione <DialogHost/> no App.');
      };
    };
  }, []);
  const d = queue[0];
  if (!d) return null;
  const done = () => setQueue((q) => q.slice(1));
  return <DialogView key={d.id} d={d} done={done} />;
}

function DialogView({ d, done }: { d: Spec; done: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (d.kind === 'prompt') return { value: d.defaultValue ?? '' };
    if (d.kind === 'form') {
      const v: Record<string, string> = {};
      for (const f of d.fields) v[f.name] = f.value ?? (f.type === 'select' ? f.options?.[0]?.value ?? '' : '');
      return v;
    }
    return {};
  });

  function cancel() {
    if (d.kind === 'alert') d.resolve();
    else if (d.kind === 'confirm') d.resolve(false);
    else d.resolve(null);
    done();
  }
  function ok(e?: FormEvent) {
    e?.preventDefault();
    if (d.kind === 'alert') d.resolve();
    else if (d.kind === 'confirm') d.resolve(true);
    else if (d.kind === 'prompt') d.resolve(values.value ?? '');
    else d.resolve(values);
    done();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = 'title' in d && d.title ? d.title : d.kind === 'alert' ? 'Aviso' : d.kind === 'confirm' ? 'Confirmação' : '';
  const confirmLabel = ('confirmLabel' in d && d.confirmLabel) || 'OK';
  const danger = d.kind === 'confirm' && d.danger;

  return (
    <div className="dlg-overlay" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form className="dlg" onSubmit={ok}>
        {title && <div className="dlg-title">{title}</div>}
        {'message' in d && d.message && <div className="dlg-msg">{d.message}</div>}

        {d.kind === 'prompt' && (
          <input
            className="dlg-input"
            autoFocus
            value={values.value}
            placeholder={d.placeholder}
            onChange={(e) => setValues({ value: e.target.value })}
          />
        )}

        {d.kind === 'form' &&
          d.fields.map((f, i) => (
            <label key={f.name} className="dlg-field">
              <span>{f.label}</span>
              {f.type === 'select' ? (
                <select autoFocus={i === 0} value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                  {(f.options || []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label ?? o.value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus={i === 0}
                  value={values[f.name]}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
              {f.hint && <span className="dlg-hint">{f.hint}</span>}
            </label>
          ))}

        <div className="dlg-actions">
          {d.kind !== 'alert' && (
            <button type="button" onClick={cancel}>
              Cancelar
            </button>
          )}
          <button type="submit" className={danger ? 'dlg-danger' : 'run'} autoFocus={d.kind === 'alert' || d.kind === 'confirm'}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
