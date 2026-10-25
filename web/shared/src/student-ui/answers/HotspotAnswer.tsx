import { useState } from "react";
import type { Point } from "../../generated/testfmt";
import type { AnswerProps } from "./AnswerArea";
import { Picture } from "./Picture";
import { nudge } from "./point";

const CENTRE: Point = { x: 0.5, y: 0.5 };

const place = (p: Point) => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });

/**
 * A hotspot question: the picture, and the answer's `point` is where the
 * student clicked, as fractions of the shown picture. The picture is also one
 * focusable element: the arrow keys move a cursor that starts at the chosen
 * point, or the centre (Shift for bigger steps), and Enter or Space chooses
 * the cursor's place. Enter chooses without moving on to the next question.
 */
export function HotspotAnswer({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  // Where the arrow keys have moved the cursor; null follows the chosen point.
  const [moved, setMoved] = useState<Point | null>(null);
  const image = question.image;
  if (!image) return null;
  const live = !readOnly && !!onChange;
  const chosen = answer?.point;
  const cursor = moved ?? chosen ?? CENTRE;
  const choose = (point: Point) => {
    setMoved(null);
    onChange?.({ point });
  };
  return (
    <Picture
      image={image}
      className="k-pic-hot"
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={live ? 0 : undefined}
      data-more-item
      // The click lands on the picture itself: the markers let clicks through.
      onClick={(e) =>
        live &&
        choose({
          x: e.nativeEvent.offsetX / e.currentTarget.clientWidth,
          y: e.nativeEvent.offsetY / e.currentTarget.clientHeight,
        })
      }
      onKeyDown={(e) => {
        if (!live) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          // The student's Enter shortcut for the next question must not fire.
          e.stopPropagation();
          choose(cursor);
          return;
        }
        const next = nudge(cursor, e.key, e.shiftKey);
        if (next) {
          e.preventDefault();
          setMoved(next);
        }
      }}
    >
      {chosen && <i className="k-marker" style={place(chosen)} />}
      <i className="k-cursor" style={place(cursor)} />
    </Picture>
  );
}
