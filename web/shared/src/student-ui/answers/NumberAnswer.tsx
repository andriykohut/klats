import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import { LineField } from "./TextAnswer";

/**
 * A number question: a one-line field for the number as typed, with `,` or `.`
 * as the decimal separator. The answer's `text` is the typed string, which
 * the server parses.
 */
export function NumberAnswer(props: AnswerProps) {
  return (
    <LineField
      {...props}
      inputMode="decimal"
      placeholder={m.number_placeholder()}
    />
  );
}
