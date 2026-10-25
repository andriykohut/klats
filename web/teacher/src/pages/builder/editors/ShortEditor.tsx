import { m } from "@klats/shared/paraglide/messages.js";
import type { EditorProps } from "./QuestionEditor";
import { AcceptedList, MatchSwitches } from "./Typed";

/**
 * The accepted answers of a short-text question, as chips, and the switches
 * for how a student's text is compared with them.
 */
export function ShortEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  return (
    <>
      <div className="b-lbl">
        {m.builder_accepted()}
        <em>{m.builder_accepted_hint()}</em>
      </div>
      <AcceptedList
        values={q.accepted ?? []}
        label={m.builder_accepted()}
        addLabel={m.builder_accepted_add()}
        removeLabel={(text) => m.builder_accepted_remove({ text })}
        onChange={(fn) =>
          onChange((x) => ({ ...x, accepted: fn(x.accepted ?? []) }))
        }
        onRemoveItem={onRemoveItem}
      />
      <MatchSwitches question={q} onChange={onChange} />
    </>
  );
}
