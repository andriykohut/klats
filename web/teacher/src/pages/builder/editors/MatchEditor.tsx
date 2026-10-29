import type { Target } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useState } from "react";
import { Button } from "react-aria-components";
import { cooldown } from "../../../cooldown";
import { Icon } from "../../../ui/icons";
import { insertAt, MAX_LIST, newOption, newTarget, plainText } from "../model";
import { RichField } from "../RichField";
import { ItemImage, ItemList, itemNames } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const DECOYS = itemNames((i) => m.builder_decoy({ number: i + 1 }), false);

/** The least pairs a matching question has, as internal/testfmt requires. */
const MIN_PAIRS = 2;

/**
 * The pairs of a matching question, and its extra choices. Each pair row holds
 * a left item and its right-hand target, so two items can never share a target.
 * The question's `targets` hold the pairs' right sides and the extra choices,
 * which are the targets no item names. Removing a pair removes its target, and
 * an undo gives both back.
 */
export function MatchEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  const targets = q.targets ?? [];
  const [focus, setFocus] = useState({ key: "", n: 0 });
  const [imageError, setImageError] = useState("");
  const [mayDelete] = useState(() => cooldown());
  const named = new Set(q.options.map((o) => o.target));
  const decoys = targets.filter((t) => !named.has(t.id));
  const pair = (i: number) => m.builder_pair({ number: i + 1 });

  const focusOn = (key: string) => setFocus((f) => ({ key, n: f.n + 1 }));
  const at = (key: string) => (focus.key === key ? focus.n : 0);

  const editLeft = (id: string, patch: object) =>
    onChange((x) => ({
      ...x,
      options: x.options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  const editRight = (id: string, patch: object) =>
    onChange((x) => ({
      ...x,
      targets: (x.targets ?? []).map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }));

  const addPairAfter = (index: number) => {
    if (targets.length >= MAX_LIST) return;
    const t = newTarget();
    const o = { ...newOption(), target: t.id };
    onChange((x) => ({
      ...x,
      options: insertAt(x.options, index + 1, o),
      targets: [...(x.targets ?? []), t],
    }));
    focusOn(`${o.id}:left`);
  };

  // Enter moves on to an empty next pair rather than adding one before it.
  const enterFrom = (index: number) => {
    const next = q.options[index + 1];
    const right = targets.find((t) => t.id === next?.target);
    if (
      next &&
      !plainText(next.content) &&
      !(right && plainText(right.content))
    ) {
      focusOn(`${next.id}:left`);
    } else addPairAfter(index);
  };

  const removePair = (index: number) => {
    if (q.options.length <= MIN_PAIRS) return;
    const gone = q.options[index];
    const goneTarget = targets.find((t) => t.id === gone.target);
    const targetIndex = goneTarget ? targets.indexOf(goneTarget) : -1;
    onRemoveItem(
      m.builder_item_removed({ item: pair(index) }),
      () =>
        onChange((x) => ({
          ...x,
          options: x.options.filter((o) => o.id !== gone.id),
          targets: (x.targets ?? []).filter((t) => t.id !== gone.target),
        })),
      () =>
        onChange((x) => ({
          ...x,
          options: insertAt(x.options, index, gone),
          targets: goneTarget
            ? insertAt(x.targets ?? [], targetIndex, goneTarget)
            : x.targets,
        })),
    );
  };

  const field = (
    key: string,
    value: Target["content"],
    label: string,
    onEdit: (doc: Target["content"]) => void,
    onEnter: () => void,
  ) => (
    <RichField
      inline
      value={value}
      onChange={onEdit}
      label={label}
      placeholder={label}
      focus={at(key)}
      onEnter={onEnter}
    />
  );

  return (
    <>
      <div className="b-lbl" data-bar-room>
        {m.builder_pairs()}
        <em>{m.builder_pairs_hint()}</em>
      </div>
      <ul className="b-opts">
        {q.options.map((o, i) => {
          const right = targets.find((t) => t.id === o.target);
          const leftName = m.builder_pair_left({ number: i + 1 });
          const rightName = m.builder_pair_right({ number: i + 1 });
          return (
            <li key={o.id} className="b-opt b-pair" data-item={o.id}>
              {field(
                `${o.id}:left`,
                o.content,
                leftName,
                (content) => editLeft(o.id, { content }),
                () => focusOn(`${o.id}:right`),
              )}
              <ItemImage
                image={o.image}
                addLabel={m.builder_item_image({ item: leftName })}
                removeLabel={m.builder_item_image_remove({ item: leftName })}
                onChange={(image) => editLeft(o.id, { image })}
                onError={setImageError}
              />
              <span className="b-pair-to">
                <Icon name="arrow" />
              </span>
              {right &&
                field(
                  `${o.id}:right`,
                  right.content,
                  rightName,
                  (content) => editRight(right.id, { content }),
                  () => enterFrom(i),
                )}
              {right && (
                <ItemImage
                  image={right.image}
                  addLabel={m.builder_item_image({ item: rightName })}
                  removeLabel={m.builder_item_image_remove({ item: rightName })}
                  onChange={(image) => editRight(right.id, { image })}
                  onError={setImageError}
                />
              )}
              <Button
                className="t-icon-btn b-opt-del"
                data-variant="danger"
                aria-label={m.builder_item_delete({ item: pair(i) })}
                isDisabled={q.options.length <= MIN_PAIRS}
                onPress={() => mayDelete() && removePair(i)}
              >
                <Icon name="close" />
              </Button>
            </li>
          );
        })}
      </ul>
      {imageError && (
        <p className="b-rich-err" role="alert">
          {imageError}
        </p>
      )}
      <Button
        className="t-btn b-add-opt"
        data-variant="dashed"
        isDisabled={targets.length >= MAX_LIST}
        onPress={() => addPairAfter(q.options.length - 1)}
      >
        <Icon name="plus" />
        {m.builder_add_pair()}
      </Button>

      <div className="b-lbl" data-bar-room>
        {m.builder_decoys()}
        <em>{m.builder_decoys_hint()}</em>
      </div>
      <ItemList
        items={decoys}
        names={DECOYS}
        addLabel={m.builder_add_decoy()}
        create={newTarget}
        max={MAX_LIST - q.options.length}
        onChange={(fn) =>
          onChange((x) => {
            const used = new Set(x.options.map((o) => o.target));
            const all = x.targets ?? [];
            return {
              ...x,
              targets: [
                ...all.filter((t) => used.has(t.id)),
                ...fn(all.filter((t) => !used.has(t.id))),
              ],
            };
          })
        }
        onRemoveItem={onRemoveItem}
      />
    </>
  );
}
