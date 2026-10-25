import { m } from "@klats/shared/paraglide/messages.js";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import { textDoc } from "../model";
import { RichField } from "../RichField";
import { tokenize } from "../words";
import type { EditorProps } from "./QuestionEditor";

/**
 * The body of a highlight question: text in which the teacher marks the
 * words students must find (see {@link RichField}'s `marked`), and a count of
 * the marked words. A word with any character marked counts once, as the
 * server counts it.
 */
export function HighlightEditor({ question: q, onChange }: EditorProps) {
  const body = (q.body ?? textDoc("")) as RichDoc;
  return (
    <>
      <div className="b-lbl">
        {m.builder_highlight_body()}
        <em>{m.builder_highlight_body_hint()}</em>
      </div>
      <RichField
        marked
        value={body}
        onChange={(doc) => onChange((x) => ({ ...x, body: doc }))}
        label={m.builder_highlight_body()}
        placeholder={m.builder_highlight_body_placeholder()}
      />
      <p className="b-hint" aria-live="polite">
        {m.builder_highlight_count({ count: tokenize(body).targets.length })}
      </p>
    </>
  );
}
