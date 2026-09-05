import { useEffect } from 'react';
import { usePreview } from '../markdown';

// <DateRange name=x title="..." [start=… end=…]/> — Evidence: ${inputs.x.start}
// e ${inputs.x.end}. Sem defaults declarados, inicia num intervalo amplo para
// o BETWEEN não filtrar tudo.
const WIDE_START = '1900-01-01';
const WIDE_END = '2100-12-31';

export default function DateRange(props: any) {
  const { inputs, setInput } = usePreview();
  const v = inputs[props.name] as { start?: string; end?: string } | undefined;
  const start = v?.start ?? props.start ?? WIDE_START;
  const end = v?.end ?? props.end ?? WIDE_END;

  useEffect(() => {
    if (inputs[props.name] === undefined) setInput(props.name, { start, end });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.name]);

  return (
    <div className="dropdown">
      <label>
        {(props.title || props.name) + ': '}
        <input type="date" value={start} onChange={(e) => setInput(props.name, { start: e.target.value, end })} />
        {' — '}
        <input type="date" value={end} onChange={(e) => setInput(props.name, { start, end: e.target.value })} />
      </label>
    </div>
  );
}
