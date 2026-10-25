import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import { CardBoard, CardFace } from "./CardBoard";
import { nameOf } from "./cards";

/**
 * A grouping question: a tray of the items and a box for each group, which
 * holds any number of them (see {@link CardBoard}). The answer's `pairs` map
 * an item's id to its group's id, and an item in the tray has no entry.
 */
export function GroupsAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const groups = question.targets ?? [];
  const slots = groups.map((g, i) => ({
    id: g.id,
    name: nameOf(g.content, m.slot_label({ number: i + 1 })),
    capacity: Infinity,
  }));
  return (
    <fieldset
      className="k-set"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <CardBoard
        cards={question.options}
        slots={slots}
        placed={answer?.pairs ?? {}}
        onChange={onChange && ((pairs) => onChange({ pairs }))}
        readOnly={readOnly}
      >
        {(slot) => (
          <div className="k-groups">
            {groups.map((g) => (
              <div className="k-group" key={g.id}>
                <div className="k-group-name">
                  <CardFace card={g} />
                </div>
                {slot(g.id)}
              </div>
            ))}
          </div>
        )}
      </CardBoard>
    </fieldset>
  );
}
