import { m } from "@klats/shared/paraglide/messages.js";
import { Label, TextArea, TextField } from "react-aria-components";
import { MAX_RUBRIC } from "../model";
import type { EditorProps } from "./QuestionEditor";

/**
 * The marking notes of a written-answer question: plain text of at most
 * {@link MAX_RUBRIC} characters that only the teacher sees. The text and the
 * points are the question's own.
 */
export function OpenEditor({ question: q, onChange }: EditorProps) {
  return (
    <TextField
      className="t-field b-rubric"
      value={q.rubric ?? ""}
      onChange={(rubric) => onChange((x) => ({ ...x, rubric }))}
    >
      <Label className="b-lbl">{m.builder_rubric()}</Label>
      <TextArea
        rows={4}
        maxLength={MAX_RUBRIC}
        placeholder={m.builder_rubric_placeholder()}
      />
    </TextField>
  );
}
