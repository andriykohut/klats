import type { Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import type { ComponentType } from "react";
import { RichField } from "../RichField";
import { BankEditor } from "./BankEditor";
import { ChoiceEditor } from "./ChoiceEditor";
import { EditorHead, Grading } from "./EditorHead";
import { GapsEditor } from "./GapsEditor";
import { GridEditor } from "./GridEditor";
import { GroupsEditor } from "./GroupsEditor";
import type { RemoveItem } from "./ItemList";
import { MatchEditor } from "./MatchEditor";
import { NumberEditor } from "./NumberEditor";
import { OrderEditor } from "./OrderEditor";
import { ShortEditor } from "./ShortEditor";
import { TrueFalseEditor } from "./TrueFalseEditor";

/** What the editor of one question type takes: the part of the editor under the question text. */
export interface EditorProps {
  question: Question;
  onChange: (fn: (q: Question) => Question) => void;
  onRemoveItem: RemoveItem;
}

const EDITORS: Record<string, ComponentType<EditorProps>> = {
  single: ChoiceEditor,
  multi: ChoiceEditor,
  truefalse: TrueFalseEditor,
  grid: GridEditor,
  short: ShortEditor,
  number: NumberEditor,
  gaps: GapsEditor,
  order: OrderEditor,
  match: MatchEditor,
  groups: GroupsEditor,
  bank: BankEditor,
};

/**
 * Edits one question: the head (see {@link EditorHead}), the question text
 * (for a type with a body, an instruction above it), the editor of the type's own parts
 * and the scoring choice (see {@link Grading}). Every edit goes through
 * `onChange` as a function of the newest question. Removing an item goes
 * through `onRemoveItem`, which owns the undo. The question text takes focus
 * when `focusText` is not 0.
 */
export function QuestionEditor(props: {
  question: Question;
  focusText: number;
  onChange: (fn: (q: Question) => Question) => void;
  onDelete: () => void;
  onRemoveItem: RemoveItem;
}) {
  const { question: q, onChange } = props;
  const Body = EDITORS[q.type];
  return (
    <div className="b-ed-in">
      <EditorHead question={q} onChange={onChange} onDelete={props.onDelete} />
      <div className="b-lbl">{m.builder_question_text()}</div>
      <RichField
        value={q.text}
        onChange={(doc) => onChange((x) => ({ ...x, text: doc }))}
        label={m.builder_question_text()}
        placeholder={m.builder_question_placeholder()}
        focus={props.focusText}
      />
      {Body && (
        <Body
          question={q}
          onChange={onChange}
          onRemoveItem={props.onRemoveItem}
        />
      )}
      <Grading question={q} onChange={onChange} />
    </div>
  );
}
