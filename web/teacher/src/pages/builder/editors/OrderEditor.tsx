import { m } from "@klats/shared/paraglide/messages.js";
import { MAX_LIST, newOption } from "../model";
import { ItemList, itemNames } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const ITEMS = itemNames((i) => m.builder_order_item({ number: i + 1 }));

/** The least items an ordering question has, as internal/testfmt requires. */
const MIN_ITEMS = 3;

/**
 * The items of an ordering question, listed in the right order: the list's
 * order is the key, and students get the items shuffled. A row moves with its
 * ↑ and ↓ buttons, or by its drag handle.
 */
export function OrderEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  return (
    <>
      <div className="b-lbl" data-bar-room>
        {m.builder_order_items()}
        <em>{m.builder_order_items_hint()}</em>
      </div>
      <ItemList
        items={q.options}
        names={ITEMS}
        addLabel={m.builder_add_order_item()}
        create={newOption}
        min={MIN_ITEMS}
        max={MAX_LIST}
        onChange={(fn) => onChange((x) => ({ ...x, options: fn(x.options) }))}
        onRemoveItem={onRemoveItem}
      />
    </>
  );
}
