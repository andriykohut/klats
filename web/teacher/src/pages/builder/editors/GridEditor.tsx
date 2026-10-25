import { m } from "@klats/shared/paraglide/messages.js";
import { newOption, newTarget, plainText } from "../model";
import { ItemList, itemNames, type RemoveItem, RowChoice } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const COLUMNS = itemNames((i) => m.builder_column({ number: i + 1 }));
const ROWS = itemNames((i) => m.builder_row({ number: i + 1 }));

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;

/**
 * The columns and rows of a choice grid: two to six column headers, and rows
 * that each have one chip per column marking the right one. A row's `target`
 * is the id of its right column. Removing a column clears the rows that named
 * it, and an undo gives them their column back.
 */
export function GridEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  const columns = q.targets ?? [];

  const removeColumn: RemoveItem = (text, remove, restore) => {
    const marked = q.options;
    onRemoveItem(
      text,
      () => {
        remove();
        onChange((x) => ({
          ...x,
          options: x.options.map((o) =>
            o.target && !x.targets?.some((t) => t.id === o.target)
              ? { ...o, target: "" }
              : o,
          ),
        }));
      },
      () => {
        restore();
        onChange((x) => ({
          ...x,
          options: x.options.map((o) => {
            const was = marked.find((r) => r.id === o.id)?.target;
            return !o.target && was && x.targets?.some((t) => t.id === was)
              ? { ...o, target: was }
              : o;
          }),
        }));
      },
    );
  };

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
        onRemoveItem={removeColumn}
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
