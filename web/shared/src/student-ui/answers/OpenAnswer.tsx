import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import "./typed.css";
import "./text.css";

/** The longest written answer the server accepts, in characters. */
export const OPEN_MAX_LENGTH = 5000;

/**
 * A written-answer question: a text area committed on every change as the
 * answer's `text`, with a count of its characters. The server counts runes,
 * so the count and the limit do too; a longer text is cut to the limit. Enter
 * starts a new line (see the student's TakeTest).
 */
export function OpenAnswer({
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const text = answer?.text ?? "";
  const count = Array.from(text).length;
  return (
    <div className="k-open">
      <textarea
        className="k-line k-open-box"
        autoComplete="off"
        spellCheck
        readOnly={readOnly}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        value={text}
        onChange={(e) => {
          const chars = Array.from(e.target.value);
          onChange?.({
            text:
              chars.length > OPEN_MAX_LENGTH
                ? chars.slice(0, OPEN_MAX_LENGTH).join("")
                : e.target.value,
          });
        }}
      />
      <div className="k-open-count">
        {m.open_count({ count, max: OPEN_MAX_LENGTH })}
      </div>
    </div>
  );
}
