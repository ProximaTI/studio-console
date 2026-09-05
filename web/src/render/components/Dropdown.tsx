import { useEffect } from 'react';
import { usePreview } from '../markdown';

// Input reativo: define inputs[name].value, usado em ${inputs.name} nas queries.
// Opções vêm de data={query} (value=/label=) OU de filhos <DropdownOption/>.
// Suporta defaultValue (string ou array) e multiple=true (Evidence).
export default function Dropdown(props: any) {
  const { dataMap, inputs, setInput } = usePreview();
  const rows = dataMap[props.data] || [];
  const valueField = props.value;
  const labelField = props.label || props.value;
  const name = props.name;
  const multiple = String(props.multiple) === 'true';
  const current = inputs[name]?.value;

  // <DropdownOption value="..." valueLabel="..."/> filhos SOMAM-SE às opções de
  // data={query} (Evidence) — caso típico: opção "Todos" (%) antes da lista.
  const optChildren = (props.__children || [])
    .filter((b: any) => b.type === 'component' && b.name === 'DropdownOption')
    .map((b: any) => ({ value: b.attrs.value ?? '', label: b.attrs.valueLabel ?? b.attrs.value ?? '' }));
  const dataOptions = rows.map((r: any) => ({ value: r[valueField], label: r[labelField] }));
  const options = [...optChildren, ...dataOptions];

  useEffect(() => {
    if (current === undefined && options.length > 0) {
      const dv = props.defaultValue;
      if (multiple) {
        const arr = Array.isArray(dv) ? dv : dv !== undefined && dv !== '' ? [dv] : [options[0].value];
        setInput(name, arr.filter((v: any) => options.some((o: any) => String(o.value) === String(v))));
      } else if (dv !== undefined && options.some((o: any) => String(o.value) === String(dv))) {
        setInput(name, dv);
      } else {
        setInput(name, options[0].value);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length, current]);

  function onChange(e: any) {
    if (multiple) {
      const vals = Array.from(e.target.selectedOptions).map((o: any) => o.value);
      setInput(name, vals);
    } else {
      setInput(name, e.target.value);
    }
  }

  return (
    <div className="dropdown">
      {props.title && <label>{props.title}: </label>}
      <select
        multiple={multiple}
        size={multiple ? Math.min(6, options.length) : undefined}
        value={multiple ? (Array.isArray(current) ? current : []) : (current ?? '')}
        onChange={onChange}
      >
        {options.map((o: any, i: number) => (
          <option key={i} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
