import type { Answer } from "../../generated/testfmt";
import type { StudentQuestion } from "../../generated/wire";
import { ChoiceAnswers } from "./ChoiceAnswers";
import { GridAnswers } from "./GridAnswers";
import { TrueFalseAnswers } from "./TrueFalseAnswers";

/** What every question type's answer component takes. */
export interface AnswerProps {
  question: StudentQuestion;
  answer?: Answer;
  /** Called with the whole new answer. Left out where nothing can be answered. */
  onChange?: (answer: Answer) => void;
  readOnly?: boolean;
  /** Id of the element holding the question text, which names the answer. */
  labelledBy: string;
  /** Id of the element holding the chip, which says how to answer. */
  describedBy: string;
}

/**
 * The part of a question's sheet the student answers in: the component of the
 * question's type, or nothing for a type with none yet. `density` is the
 * sheet's tile density step and `onDensity` asks it to change (see
 * {@link ChoiceAnswers}).
 */
export function AnswerArea({
  density,
  onDensity,
  ...props
}: AnswerProps & { density: number; onDensity: (density: number) => void }) {
  switch (props.question.type) {
    case "single":
    case "multi":
      return (
        <ChoiceAnswers {...props} density={density} onDensity={onDensity} />
      );
    case "truefalse":
      return <TrueFalseAnswers {...props} />;
    case "grid":
      return <GridAnswers {...props} />;
    default:
      return null;
  }
}
