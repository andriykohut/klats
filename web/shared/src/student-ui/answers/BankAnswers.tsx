import { m } from "../../paraglide/messages.js";
import { RichView } from "../../rich/RichView";
import { walkNodes } from "../../rich/walk";
import type { AnswerProps } from "./AnswerArea";
import { CardBoard } from "./CardBoard";
import { invert } from "./cards";

/**
 * A word bank question: the body with a place in each gap and a tray of the
 * words, decoys among them (see {@link CardBoard}). A gap holds one word. The
 * answer's `pairs` map a gap's id to its word's id, and an empty gap has no
 * entry. Each gap is named «Пропуск N» for its place in the body.
 */
export function BankAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  if (!question.body) return null;
  const ids: string[] = [];
  walkNodes(question.body, (n) => {
    if (n.type === "gap" && n.attrs?.id) ids.push(n.attrs.id);
  });
  const slots = ids.map((id, i) => ({
    id,
    name: m.gap_label({ number: i + 1 }),
    capacity: 1,
  }));
  return (
    <fieldset
      className="k-set k-bank-set"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <CardBoard
        cards={question.options}
        slots={slots}
        placed={invert(answer?.pairs ?? {})}
        onChange={onChange && ((placed) => onChange({ pairs: invert(placed) }))}
        readOnly={readOnly}
      >
        {(slot) => (
          <div className="k-bank">
            <RichView doc={question.body} gap={slot} />
          </div>
        )}
      </CardBoard>
    </fieldset>
  );
}
