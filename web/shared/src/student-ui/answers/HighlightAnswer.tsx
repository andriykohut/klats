import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";
import { type RichDoc, RichView } from "../../rich/RichView";
import type { AnswerProps } from "./AnswerArea";
import "./text.css";

/**
 * A highlight question: its text with every word a toggle button. The answer's
 * `items` are the chosen words' indexes as decimal strings, counted through
 * the text as the server numbers its word nodes. The words are one tab stop:
 * the arrow keys move between them and Space toggles.
 */
export function HighlightAnswer({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  return (
    <ToggleButtonGroup
      className="k-words"
      selectionMode="multiple"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      isDisabled={readOnly || !onChange}
      selectedKeys={answer?.items ?? []}
      onSelectionChange={(keys) =>
        onChange?.({ items: [...keys].map(String).sort((a, b) => +a - +b) })
      }
    >
      <RichView
        doc={question.body as RichDoc}
        word={(i, children) => (
          <ToggleButton id={String(i)} className="k-word">
            {children}
          </ToggleButton>
        )}
      />
    </ToggleButtonGroup>
  );
}
