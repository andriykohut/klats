import type { NumberKey } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useEffect, useRef, useState } from "react";
import {
  I18nProvider,
  Input,
  Label,
  NumberField,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import type { EditorProps } from "./QuestionEditor";

type Mode = "exact" | "tolerance" | "range";
type Field = "value" | "tolerance" | "min" | "max";

const MODES: [Mode, () => string][] = [
  ["exact", m.builder_number_exact],
  ["tolerance", m.builder_number_tolerance],
  ["range", m.builder_number_range],
];

/** The fields each mode needs, in the order they are shown. */
const FIELDS: Record<Mode, [Field, () => string][]> = {
  exact: [["value", m.builder_number_value]],
  tolerance: [
    ["value", m.builder_number_value],
    ["tolerance", m.builder_number_margin],
  ],
  range: [
    ["min", m.builder_number_min],
    ["max", m.builder_number_max],
  ],
};

/**
 * An input for a number field that turns a typed or pasted dot into the uk
 * decimal comma before React Aria sees the text, which would drop the dot
 * («10.5» would read as 105). uk-UA groups thousands with a space, so no dot
 * is ever meant as a separator.
 */
function DecimalInput() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const dotToComma = (e: InputEvent) => {
      const text = e.data ?? e.dataTransfer?.getData("text/plain");
      if (!text?.includes(".")) return;
      e.preventDefault();
      document.execCommand("insertText", false, text.replaceAll(".", ","));
    };
    // In the capture phase, to run before React Aria's own listener.
    el.addEventListener("beforeinput", dotToComma, true);
    return () => el.removeEventListener("beforeinput", dotToComma, true);
  }, []);
  return <Input ref={input} />;
}

/** The fields as typed: NaN for one that is empty. */
type Fields = Record<Field, number>;

/** Returns the key for `mode` once all its fields are filled, or undefined. */
function keyOf(mode: Mode, fields: Fields): NumberKey | undefined {
  const needed = FIELDS[mode].map(([field]) => field);
  if (needed.some((field) => Number.isNaN(fields[field]))) return undefined;
  const key: NumberKey = { mode, value: 0, tolerance: 0, min: 0, max: 0 };
  for (const field of needed) key[field] = fields[field];
  return key;
}

/**
 * The right answer of a number question: exactly a value, a value with a
 * margin, or a range. The fields are in the uk-UA locale: the comma is the
 * decimal separator, and a typed or pasted dot becomes one (see
 * {@link DecimalInput}). The
 * question's `number` stays unset until every field of the chosen mode is
 * filled, and each mode keeps what was typed in its fields while another is
 * chosen. A range that is reversed or a negative margin is the server's
 * check to report.
 */
export function NumberEditor({ question: q, onChange }: EditorProps) {
  const [mode, setMode] = useState<Mode>((q.number?.mode as Mode) ?? "exact");
  const [fields, setFields] = useState<Fields>(() => {
    const out: Fields = { value: NaN, tolerance: NaN, min: NaN, max: NaN };
    if (q.number) {
      for (const [field] of FIELDS[mode]) out[field] = q.number[field];
    }
    return out;
  });

  const set = (nextMode: Mode, next: Fields) => {
    setMode(nextMode);
    setFields(next);
    onChange((x) => ({ ...x, number: keyOf(nextMode, next) }));
  };

  return (
    <>
      <div className="b-lbl">{m.builder_number_key()}</div>
      <ToggleButtonGroup
        className="b-seg"
        aria-label={m.builder_number_mode()}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[mode]}
        onSelectionChange={(keys) => {
          const [next] = keys;
          if (next) set(next as Mode, fields);
        }}
      >
        {MODES.map(([id, name]) => (
          <ToggleButton key={id} id={id} className="b-seg-btn">
            {name()}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <I18nProvider locale="uk-UA">
        <div className="b-num-row">
          {FIELDS[mode].map(([field, name]) => (
            <NumberField
              key={`${mode}-${field}`}
              className="t-field b-num"
              value={fields[field]}
              formatOptions={{ maximumFractionDigits: 10, useGrouping: false }}
              onChange={(v) => set(mode, { ...fields, [field]: v })}
            >
              <Label>{name()}</Label>
              <DecimalInput />
            </NumberField>
          ))}
        </div>
      </I18nProvider>
    </>
  );
}
