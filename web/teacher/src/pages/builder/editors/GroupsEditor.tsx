import type { Option, Target } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Icon } from "../../../ui/icons";
import { insertAt, MAX_LIST, newOption, newTarget, plainText } from "../model";
import { RichField } from "../RichField";
import { ItemImage, ItemList, itemNames } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const LOOSE = itemNames(
  (i) => m.builder_group_loose_item({ number: i + 1 }),
  false,
);

const MIN_GROUPS = 2;
const MAX_GROUPS = 6;

/**
 * The groups of a grouping question as columns, each with a name and its own
 * items; an item's `target` is the id of its group. A group's items go with it
 * when it is removed, and an undo brings both back, so no item is left naming a
 * group that is gone. Items that name no group (a converted question has them)
 * wait in a list of their own until they are given one. Every item has a choice
 * of group, which is how an item moves to another column.
 */
export function GroupsEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  const groups = q.targets ?? [];
  const [focus, setFocus] = useState({ id: "", n: 0 });
  const [imageError, setImageError] = useState("");
  // The item whose group was just changed: its row is rebuilt in another
  // column, which drops focus, so its group choice takes focus back.
  const [moved, setMoved] = useState({ id: "", n: 0 });
  const root = useRef<HTMLDivElement>(null);
  const loose = q.options.filter((o) => !groups.some((g) => g.id === o.target));

  useEffect(() => {
    if (!moved.n) return;
    root.current
      ?.querySelector<HTMLElement>(
        `[data-item="${CSS.escape(moved.id)}"] .b-group-sel`,
      )
      ?.focus();
  }, [moved]);

  /** What the items of a list may grow by: the rest of the question's 50. */
  const room = (items: Option[]) =>
    MAX_LIST - (q.options.length - items.length);

  const editGroup = (id: string, patch: Partial<Target>) =>
    onChange((x) => ({
      ...x,
      targets: (x.targets ?? []).map((g) =>
        g.id === id ? { ...g, ...patch } : g,
      ),
    }));

  const addGroup = () => {
    const g = newTarget();
    onChange((x) => ({ ...x, targets: [...(x.targets ?? []), g] }));
    setFocus((f) => ({ id: g.id, n: f.n + 1 }));
  };

  const removeGroup = (index: number) => {
    if (groups.length <= MIN_GROUPS) return;
    const gone = groups[index];
    // The items of the group, as they are when it is removed.
    const items = q.options.filter((o) => o.target === gone.id);
    onRemoveItem(
      m.builder_item_removed({ item: m.builder_group({ number: index + 1 }) }),
      () =>
        onChange((x) => ({
          ...x,
          targets: (x.targets ?? []).filter((g) => g.id !== gone.id),
          options: x.options.filter((o) => o.target !== gone.id),
        })),
      () =>
        onChange((x) => ({
          ...x,
          targets: insertAt(x.targets ?? [], index, gone),
          options: [...x.options, ...items],
        })),
    );
  };

  /** Applies `fn` to the items under group `id` (`""` for those under none). */
  const editItems = (id: string, fn: (items: Option[]) => Option[]) =>
    onChange((x) => {
      const under = (o: Option) =>
        id
          ? o.target === id
          : !(x.targets ?? []).some((g) => g.id === o.target);
      return {
        ...x,
        options: [
          ...x.options.filter((o) => !under(o)),
          ...fn(x.options.filter(under)),
        ],
      };
    });

  /** The choice of group beside an item. */
  const groupChoice = (o: Option, name: string) => (
    <select
      className="b-group-sel"
      aria-label={m.builder_group_item_group({ item: name })}
      value={groups.some((g) => g.id === o.target) ? o.target : ""}
      onChange={(e) => {
        const target = e.target.value;
        onChange((x) => ({
          ...x,
          options: x.options.map((y) => (y.id === o.id ? { ...y, target } : y)),
        }));
        setMoved((s) => ({ id: o.id, n: s.n + 1 }));
      }}
    >
      {!groups.some((g) => g.id === o.target) && (
        <option value="">{m.builder_group_none()}</option>
      )}
      {groups.map((g, j) => (
        <option key={g.id} value={g.id}>
          {plainText(g.content) || m.builder_group({ number: j + 1 })}
        </option>
      ))}
    </select>
  );

  return (
    <div ref={root}>
      <div className="b-lbl">
        {m.builder_groups()}
        <em>{m.builder_groups_hint()}</em>
      </div>
      <div className="b-groups">
        {groups.map((g, gi) => {
          const nameLabel = m.builder_group_name({ number: gi + 1 });
          const names = itemNames(
            (i) => m.builder_group_item({ group: gi + 1, number: i + 1 }),
            false,
          );
          return (
            <fieldset
              key={g.id}
              className="b-group"
              aria-label={m.builder_group({ number: gi + 1 })}
            >
              <header className="b-group-head">
                <RichField
                  inline
                  value={g.content}
                  onChange={(content) => editGroup(g.id, { content })}
                  label={nameLabel}
                  placeholder={nameLabel}
                  focus={focus.id === g.id ? focus.n : 0}
                />
                <ItemImage
                  image={g.image}
                  addLabel={m.builder_item_image({ item: nameLabel })}
                  removeLabel={m.builder_item_image_remove({ item: nameLabel })}
                  onChange={(image) => editGroup(g.id, { image })}
                  onError={setImageError}
                />
                <Button
                  className="t-icon-btn b-opt-del"
                  data-variant="danger"
                  aria-label={m.builder_item_delete({
                    item: m.builder_group({ number: gi + 1 }),
                  })}
                  isDisabled={groups.length <= MIN_GROUPS}
                  onPress={() => removeGroup(gi)}
                >
                  <Icon name="close" />
                </Button>
              </header>
              <ItemList
                items={q.options.filter((o) => o.target === g.id)}
                max={room(q.options.filter((o) => o.target === g.id))}
                names={names}
                addLabel={m.builder_add_group_item({ group: gi + 1 })}
                create={() => ({ ...newOption(), target: g.id })}
                onChange={(fn) => editItems(g.id, fn)}
                onRemoveItem={onRemoveItem}
                trailing={(o, i) => groupChoice(o, names.field(i))}
              />
            </fieldset>
          );
        })}
      </div>
      {imageError && (
        <p className="b-rich-err" role="alert">
          {imageError}
        </p>
      )}
      <Button
        className="t-btn b-add-opt"
        data-variant="dashed"
        isDisabled={groups.length >= MAX_GROUPS}
        onPress={addGroup}
      >
        <Icon name="plus" />
        {m.builder_add_group()}
      </Button>

      {loose.length > 0 && (
        <fieldset className="b-group" aria-label={m.builder_group_none()}>
          <div className="b-lbl">{m.builder_group_none()}</div>
          <ItemList
            items={loose}
            max={room(loose)}
            names={LOOSE}
            create={newOption}
            onChange={(fn) => editItems("", fn)}
            onRemoveItem={onRemoveItem}
            trailing={(o, i) => groupChoice(o, LOOSE.field(i))}
          />
        </fieldset>
      )}
    </div>
  );
}
