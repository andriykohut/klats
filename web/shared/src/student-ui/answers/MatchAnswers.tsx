import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import { CardBoard, CardFace } from "./CardBoard";
import { invert, nameOf } from "./cards";

/**
 * A matching question: a row for each left item with a place beside it, and a
 * tray of right-hand cards, decoys among them (see {@link CardBoard}). A place
 * holds one card. The answer's `pairs` map a left item's id to its card's id,
 * and an item without a card has no entry.
 */
export function MatchAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const slots = question.options.map((o, i) => ({
    id: o.id,
    name: nameOf(o.content, m.slot_label({ number: i + 1 })),
    capacity: 1,
  }));
  return (
    <fieldset
      className="k-set"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <CardBoard
        cards={question.targets ?? []}
        slots={slots}
        placed={invert(answer?.pairs ?? {})}
        onChange={onChange && ((placed) => onChange({ pairs: invert(placed) }))}
        readOnly={readOnly}
      >
        {(slot) => (
          <div className="k-pairs">
            {question.options.map((o) => (
              <div className="k-pair" key={o.id}>
                <div className="k-pair-left">
                  <CardFace card={o} />
                </div>
                {slot(o.id)}
              </div>
            ))}
          </div>
        )}
      </CardBoard>
    </fieldset>
  );
}
