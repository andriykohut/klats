import { motion, useReducedMotionConfig } from "motion/react";
import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";
import { RadioButton, RadioField } from "react-aria-components/RadioGroup";
import type { Image } from "../generated/testfmt";
import { MediaImage, type RichDoc, RichView } from "../rich/RichView";
import { BADGE_LETTERS } from "./badges";
import { popIn } from "./motion";
import "./student-ui.css";
import "./AnswerTile.css";

export interface AnswerTileProps {
  /** Option id, the value the surrounding group selects. */
  id: string;
  /** Position among the options, from 0; picks the badge letter. */
  index: number;
  content: RichDoc;
  /** A picture shown above the text, or at its left in a row layout. */
  image?: Image;
  /** A checkbox inside a CheckboxGroup when set, a radio inside a RadioGroup otherwise. */
  multi: boolean;
}

/**
 * One answer option as a chunky tile with a letter badge: round with a dot
 * when picked for single choice, square with a tick for multi choice. It must
 * sit inside the matching React Aria group, which owns the selection. Options
 * past the ninth get their number as the badge. Focusing the tile scrolls it
 * into view within the sheet.
 */
export function AnswerTile({
  id,
  index,
  content,
  image,
  multi,
}: AnswerTileProps) {
  const reduced = useReducedMotionConfig();
  const face = (
    <TileFace index={index} content={content} image={image} multi={multi} />
  );
  return (
    <motion.div
      className="k-tile-wrap"
      data-option={id}
      onFocus={(e) =>
        e.currentTarget.scrollIntoView({
          block: "nearest",
          behavior: reduced ? "auto" : "smooth",
        })
      }
      {...popIn(0.22 + index * 0.06, reduced)}
    >
      {multi ? (
        <CheckboxField value={id} className="k-tile-field">
          <CheckboxButton className="k-tile">{face}</CheckboxButton>
        </CheckboxField>
      ) : (
        <RadioField value={id} className="k-tile-field">
          <RadioButton className="k-tile">{face}</RadioButton>
        </RadioField>
      )}
    </motion.div>
  );
}

/** The visible tile without any behaviour; QuestionSheet also measures it. */
export function TileFace({
  index,
  content,
  image,
  multi,
}: {
  index: number;
  content: RichDoc;
  image?: Image;
  multi: boolean;
}) {
  return (
    <span className="k-face">
      <span
        className={multi ? "k-badge" : "k-badge k-badge-single"}
        aria-hidden="true"
      >
        <span className="k-badge-letter">
          {BADGE_LETTERS[index] ?? index + 1}
        </span>
        {multi ? (
          <svg className="k-badge-check" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
          </svg>
        ) : (
          <span className="k-badge-dot" />
        )}
      </span>
      <span className="k-tile-body">
        {image && (
          <MediaImage
            className="k-tile-img"
            src={image.src}
            w={image.w}
            h={image.h}
          />
        )}
        <span className="k-tile-text">
          <RichView doc={content} />
        </span>
      </span>
    </span>
  );
}
