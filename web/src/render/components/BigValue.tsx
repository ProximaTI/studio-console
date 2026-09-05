import { usePreview } from '../markdown';
import { formatNumber } from '../../format';

export default function BigValue(props: any) {
  const { dataMap, errors, settings } = usePreview();
  if (errors[props.data]) return <div className="bigvalue card error">{errors[props.data]}</div>;
  const rows = dataMap[props.data];
  const v = rows && rows[0] ? rows[0][props.value] : undefined;
  return (
    <div className="bigvalue card">
      <div className="bv-title">{props.title || props.value}</div>
      <div className="bv-value">{formatNumber(v, props.fmt, settings)}</div>
    </div>
  );
}
