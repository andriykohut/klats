import type { AnswerProps } from "./AnswerArea";
import "./typed.css";

/** The longest typed answer or gap the server accepts, in characters. */
export const MAX_LENGTH = 200;

/**
 * A short-answer question: one line of text, committed on every change as the
 * answer's `text`. Enter moves on (see `data-enter-next` in the student's
 * TakeTest). The field shows the stored answer, so a reload keeps what was
 * typed.
 */
export function TextAnswer(props: AnswerProps) {
  return <LineField {...props} />;
}

/** The one-line field behind {@link TextAnswer} and NumberAnswer. */
export function LineField({
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
  inputMode,
  placeholder,
}: AnswerProps & { inputMode?: "decimal"; placeholder?: string }) {
  return (
    <input
      type="text"
      className="k-line"
      data-enter-next
      maxLength={MAX_LENGTH}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      inputMode={inputMode}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={answer?.text ?? ""}
      onChange={(e) => onChange?.({ text: e.target.value })}
    />
  );
}
