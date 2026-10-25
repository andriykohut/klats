import { useId } from "react";
import {
  RadioButton,
  RadioField,
  RadioGroup,
} from "react-aria-components/RadioGroup";
import type { StudentOption } from "../../generated/wire";
import { m } from "../../paraglide/messages.js";
import { MediaImage, RichView } from "../../rich/RichView";
import type { AnswerProps } from "./AnswerArea";
import "./choice.css";

/**
 * A true/false question: each statement is its own radio group, named by the
 * statement, with «Правда» and «Неправда». The answer's `pairs` map a
 * statement's id to `"true"` or `"false"`, and a statement left alone has no
 * entry. Each row is marked `data-more-item` for the sheet's overflow cue.
 */
export function TrueFalseAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const pairs = answer?.pairs ?? {};
  return (
    <fieldset
      className="k-tf"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {question.options.map((o) => (
        <Statement
          key={o.id}
          option={o}
          value={pairs[o.id] ?? null}
          readOnly={readOnly}
          onChange={(v) => onChange?.({ pairs: { ...pairs, [o.id]: v } })}
        />
      ))}
    </fieldset>
  );
}

function Statement({
  option,
  value,
  readOnly,
  onChange,
}: {
  option: StudentOption;
  value: string | null;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const textId = useId();
  return (
    <div className="k-tf-row" data-more-item>
      <div className="k-tf-text" id={textId}>
        {option.image && (
          <MediaImage
            className="k-pick-img"
            src={option.image.src}
            w={option.image.w}
            h={option.image.h}
          />
        )}
        <RichView doc={option.content} />
      </div>
      <RadioGroup
        className="k-tf-pick"
        aria-labelledby={textId}
        orientation="horizontal"
        isReadOnly={readOnly}
        value={value}
        onChange={onChange}
      >
        <RadioField value="true" className="k-pick-field">
          <RadioButton className="k-pick">{m.answer_true()}</RadioButton>
        </RadioField>
        <RadioField value="false" className="k-pick-field">
          <RadioButton className="k-pick">{m.answer_false()}</RadioButton>
        </RadioField>
      </RadioGroup>
    </div>
  );
}
