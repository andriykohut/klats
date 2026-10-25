import type { ReactNode } from "react";
import { Button } from "react-aria-components/Button";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Popover } from "react-aria-components/Popover";
import { Select, SelectValue } from "react-aria-components/Select";
import { withPair } from "../../answers";
import type { StudentGap } from "../../generated/wire";
import { m } from "../../paraglide/messages.js";
import { RichView } from "../../rich/RichView";
import { walkNodes } from "../../rich/walk";
import type { AnswerProps } from "./AnswerArea";
import { MAX_LENGTH } from "./TextAnswer";
import "./typed.css";

/**
 * A fill-in-the-blanks question: the body with a field in each gap. A typed
 * gap is a text field that starts 8 characters wide and grows with its text.
 * A list gap is a select of the gap's choices. Each field is named «Пропуск N»
 * for the gap's place in the body. The answer's `pairs` map a gap's id to the
 * typed text or the picked choice's id, and an empty gap has no entry.
 */
export function GapsAnswer({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  if (!question.body) return null;
  const pairs = answer?.pairs ?? {};
  const order: string[] = [];
  walkNodes(question.body, (n) => {
    if (n.type === "gap" && n.attrs?.id) order.push(n.attrs.id);
  });
  const gaps = new Map((question.gaps ?? []).map((g) => [g.id, g]));
  const field = (id: string): ReactNode => {
    const gap = gaps.get(id);
    if (!gap) return null;
    const props = {
      gap,
      label: m.gap_label({ number: order.indexOf(id) + 1 }),
      value: pairs[id] ?? "",
      readOnly,
      onChange: (v: string) => onChange?.({ pairs: withPair(pairs, id, v) }),
    };
    return gap.choices?.length ? (
      <ListGap {...props} />
    ) : (
      <TypedGap {...props} />
    );
  };
  return (
    <fieldset
      className="k-gaps"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <RichView doc={question.body} gap={field} />
    </fieldset>
  );
}

interface GapFieldProps {
  gap: StudentGap;
  label: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}

/**
 * A text field sized by a hidden copy of its text in the same grid cell, since
 * `field-sizing` is missing from Chrome 109 and Firefox 115. The input's own
 * `size` is 1 so that its default width does not widen the cell.
 */
function TypedGap({ label, value, readOnly, onChange }: GapFieldProps) {
  return (
    <span className="k-gap-typed">
      <span className="k-gap-mirror" aria-hidden="true">
        {value}
      </span>
      <input
        type="text"
        size={1}
        data-enter-next
        maxLength={MAX_LENGTH}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        readOnly={readOnly}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/** A select of the gap's choices, in the order the server sent them. */
function ListGap({ gap, label, value, readOnly, onChange }: GapFieldProps) {
  return (
    <Select
      className="k-gap-list"
      aria-label={label}
      placeholder={m.gap_choose()}
      isDisabled={readOnly}
      selectedKey={value || null}
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
    >
      <Button className="k-gap-pick">
        <SelectValue />
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9.5l6 6 6-6" />
        </svg>
      </Button>
      <Popover
        className="k-pop k-gap-pop"
        placement="bottom start"
        data-keys-off
      >
        <ListBox className="k-gap-options">
          {(gap.choices ?? []).map((c) => (
            <ListBoxItem
              key={c.id}
              id={c.id}
              textValue={c.text}
              className="k-gap-option"
            >
              {c.text}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
