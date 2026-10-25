import { m } from "@klats/shared/paraglide/messages.js";
import { newOption, newTarget, plainText } from "../model";
import { ItemList, itemNames, RowChoice } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const COLUMNS = itemNames((i) => m.builder_column({ number: i + 1 }));
const ROWS = itemNames((i) => m.builder_row({ number: i + 1 }));

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;

/**
 * The columns and rows of a choice grid: two to six column headers, and rows
 * that each have one chip per column marking the right one. A row's `target`
 * is the id of its right column. Removing a column leaves that id dangling
 * in the rows that named it: the server clears it, and an undo makes it right
 * again.
 */
export function GridEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  const columns = q.targets ?? [];
  return (
    <>
      <div className="b-lbl">
        {m.builder_columns()}
        <em>{m.builder_columns_hint()}</em>
      </div>
      <ItemList
        items={columns}
        names={COLUMNS}
        addLabel={m.builder_add_column()}
        create={newTarget}
        min={MIN_COLUMNS}
        max={MAX_COLUMNS}
        onChange={(fn) =>
          onChange((x) => ({ ...x, targets: fn(x.targets ?? []) }))
        }
        onRemoveItem={onRemoveItem}
      />

      <div className="b-lbl">
        {m.builder_rows()}
        <em>{m.builder_rows_hint()}</em>
      </div>
      <ItemList
        items={q.options}
        names={ROWS}
        addLabel={m.builder_add_row()}
        create={newOption}
        onChange={(fn) => onChange((x) => ({ ...x, options: fn(x.options) }))}
        onRemoveItem={onRemoveItem}
        trailing={(o, i) => (
          <RowChoice
            label={m.builder_row_right({ number: i + 1 })}
            value={o.target ?? ""}
            choices={columns.map((c, j) => ({
              id: c.id,
              name: plainText(c.content) || m.builder_column({ number: j + 1 }),
            }))}
            onChange={(target) =>
              onChange((x) => ({
                ...x,
                options: x.options.map((y) =>
                  y.id === o.id ? { ...y, target } : y,
                ),
              }))
            }
          />
        )}
      />
    </>
  );
}
