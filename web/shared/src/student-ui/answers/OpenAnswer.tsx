import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import "./typed.css";
import "./text.css";

/** The longest written answer the server accepts, in runes. */
export const OPEN_MAX_LENGTH = 5000;

/**
 * A written-answer question: a text area committed on every change as the
 * answer's `text`, with a count of its characters. The count and the field's
 * `maxLength` are in UTF-16 units, which are never fewer than the runes the
 * server limits, so a text the field takes is never rejected; a character
 * outside the basic plane counts as 2. Enter starts a new line (see the
 * student's TakeTest).
 */
export function OpenAnswer({
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const text = answer?.text ?? "";
  return (
    <div className="k-open">
      <textarea
        className="k-line k-open-box"
        maxLength={OPEN_MAX_LENGTH}
        autoComplete="off"
        spellCheck
        readOnly={readOnly}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        value={text}
        onChange={(e) => onChange?.({ text: e.target.value })}
      />
      <div className="k-open-count">
        {m.open_count({ count: text.length, max: OPEN_MAX_LENGTH })}
      </div>
    </div>
  );
}
