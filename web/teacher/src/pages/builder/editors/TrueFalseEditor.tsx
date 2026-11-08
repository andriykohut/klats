import { m } from "@klats/shared/paraglide/messages.js";
import { MAX_LIST, newOption } from "../model";
import { ItemList, itemNames, RowChoice } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const NAMES = itemNames((i) => m.builder_statement({ number: i + 1 }));

/**
 * The statements of a true/false question. Each row has «Правда» and
 * «Неправда» chips; `correct` is true for a statement that is true.
 */
export function TrueFalseEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  return (
    <>
      <div className="b-lbl" data-bar-room>
        {m.builder_statements()}
        <em>{m.builder_statements_hint()}</em>
      </div>
      <ItemList
        items={q.options}
        names={NAMES}
        addLabel={m.builder_add_statement()}
        create={newOption}
        max={MAX_LIST}
        onChange={(fn) => onChange((x) => ({ ...x, options: fn(x.options) }))}
        onRemoveItem={onRemoveItem}
        trailing={(o, i) => (
          <RowChoice
            label={m.builder_statement_value({ number: i + 1 })}
            value={o.correct ? "true" : "false"}
            choices={[
              { id: "true", name: m.answer_true() },
              { id: "false", name: m.answer_false() },
            ]}
            onChange={(v) =>
              onChange((x) => ({
                ...x,
                options: x.options.map((y) =>
                  y.id === o.id ? { ...y, correct: v === "true" } : y,
                ),
              }))
            }
          />
        )}
      />
    </>
  );
}
