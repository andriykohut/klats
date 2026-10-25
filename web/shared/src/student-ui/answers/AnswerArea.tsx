import type { Answer } from "../../generated/testfmt";
import type { StudentQuestion } from "../../generated/wire";
import { BankAnswers } from "./BankAnswers";
import { ChoiceAnswers } from "./ChoiceAnswers";
import { GapsAnswer } from "./GapsAnswer";
import { GridAnswers } from "./GridAnswers";
import { GroupsAnswers } from "./GroupsAnswers";
import { MatchAnswers } from "./MatchAnswers";
import { NumberAnswer } from "./NumberAnswer";
import { OrderAnswers } from "./OrderAnswers";
import { TextAnswer } from "./TextAnswer";
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
    case "short":
      return <TextAnswer {...props} />;
    case "number":
      return <NumberAnswer {...props} />;
    case "gaps":
      return <GapsAnswer {...props} />;
    case "order":
      return <OrderAnswers {...props} />;
    case "match":
      return <MatchAnswers {...props} />;
    case "groups":
      return <GroupsAnswers {...props} />;
    case "bank":
      return <BankAnswers {...props} />;
    default:
      return null;
  }
}
