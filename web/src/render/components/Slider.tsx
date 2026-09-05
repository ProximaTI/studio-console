import { useEffect } from 'react';
import { usePreview } from '../markdown';

// <Slider name=x title="..." min=0 max=100 step=1 defaultValue=0/> —
// Evidence: ${inputs.x} (número). Predicado padrão do wizard: limiar mínimo.
export default function Slider(props: any) {
  const { inputs, setInput } = usePreview();
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const step = Number(props.step ?? 1);
  const cur = Number(inputs[props.name]?.value ?? props.defaultValue ?? min);

  useEffect(() => {
    if (inputs[props.name] === undefined) setInput(props.name, Number(props.defaultValue ?? min));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.name]);

  return (
    <div className="dropdown">
      <label>
        {(props.title || props.name) + ': '}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={cur}
          onChange={(e) => setInput(props.name, Number(e.target.value))}
        />
        <span className="mono small">{cur}</span>
      </label>
    </div>
  );
}
