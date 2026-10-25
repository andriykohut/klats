import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import { CardBoard } from "./CardBoard";
import { Picture } from "./Picture";

/**
 * A labelling question: a tray of labels, decoys among them, and the picture
 * with a place for one label at each of the question's points (see
 * {@link CardBoard}). A place shows its number until a label sits on it. The
 * answer's `pairs` map a label's id to its point's id, and a label in the
 * tray has no entry.
 */
export function LabelAnswer({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const image = question.image;
  if (!image) return null;
  const points = question.targets ?? [];
  const placed = answer?.pairs ?? {};
  const covered = new Set(Object.values(placed));
  const slots = points.map((p, i) => ({
    id: p.id,
    name: m.point_label({ number: i + 1 }),
    capacity: 1,
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
        placed={placed}
        onChange={onChange && ((pairs) => onChange({ pairs }))}
        readOnly={readOnly}
      >
        {(slot) => (
          <Picture image={image}>
            {points.map((p, i) => (
              <div
                className="k-pin"
                key={p.id}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              >
                {!covered.has(p.id) && (
                  <span className="k-pin-no" aria-hidden="true">
                    {i + 1}
                  </span>
                )}
                {slot(p.id)}
              </div>
            ))}
          </Picture>
        )}
      </CardBoard>
    </fieldset>
  );
}
