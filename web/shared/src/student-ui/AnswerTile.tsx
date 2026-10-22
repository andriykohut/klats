import { motion } from "motion/react";
import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";
import { RadioButton, RadioField } from "react-aria-components/RadioGroup";
import { type RichDoc, RichView } from "../rich/RichView";
import { popIn } from "./motion";
import "./student-ui.css";

/** Badge letters for options 1–9, matching the number keys; Ґ is skipped. */
export const BADGE_LETTERS = ["А", "Б", "В", "Г", "Д", "Е", "Є", "Ж", "З"];

export interface AnswerTileProps {
  /** Option id, the value the surrounding group selects. */
  id: string;
  /** Position among the options, from 0; picks the badge letter. */
  index: number;
  content: RichDoc;
  /** A checkbox inside a CheckboxGroup when set, a radio inside a RadioGroup otherwise. */
  multi: boolean;
}

/**
 * One answer option as a chunky tile with a letter badge. It must sit inside
 * the matching React Aria group, which owns the selection. Options past the
 * ninth get their number as the badge.
 */
export function AnswerTile({ id, index, content, multi }: AnswerTileProps) {
  const face = <TileFace index={index} content={content} />;
  return (
    <motion.div className="k-tile-wrap" {...popIn(0.22 + index * 0.06)}>
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
}: {
  index: number;
  content: RichDoc;
}) {
  return (
    <span className="k-face">
      <span className="k-badge" aria-hidden="true">
        <span className="k-badge-letter">
          {BADGE_LETTERS[index] ?? index + 1}
        </span>
        <svg className="k-badge-check" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
        </svg>
      </span>
      <span className="k-tile-text">
        <RichView doc={content} />
      </span>
    </span>
  );
}
