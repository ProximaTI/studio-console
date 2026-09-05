import { useEffect } from 'react';
import { usePreview } from '../markdown';

// <TextInput name=x title="..." defaultValue="%"/> — Evidence: ${inputs.x}
// (sem .value; a console aceita as duas formas via templating).
export default function TextInput(props: any) {
  const { inputs, setInput } = usePreview();
  const cur = inputs[props.name]?.value ?? props.defaultValue ?? '';

  // Semeia o default para o SQL ter valor já no primeiro render.
  useEffect(() => {
    if (inputs[props.name] === undefined) setInput(props.name, props.defaultValue ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.name]);

  return (
    <div className="dropdown">
      <label>
        {(props.title || props.name) + ': '}
        <input
          type="text"
          value={String(cur)}
          placeholder={props.placeholder || ''}
          onChange={(e) => setInput(props.name, e.target.value)}
        />
      </label>
    </div>
  );
}
