import { Input, NumberField } from "react-aria-components";

/**
 * A number field named `label` whose value stays from `min` to `max`. A
 * cleared field keeps the value it had.
 */
export function Count(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      className="t-field s-num"
      aria-label={props.label}
      value={props.value}
      minValue={props.min}
      maxValue={props.max}
      // A cleared field commits NaN, which keeps the value it had.
      onChange={(v) => !Number.isNaN(v) && props.onChange(v)}
    >
      <Input />
    </NumberField>
  );
}
