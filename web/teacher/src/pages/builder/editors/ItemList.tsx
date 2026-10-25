import type { Option, Target } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { MediaImage } from "@klats/shared/rich/RichView.tsx";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Button,
  FileTrigger,
  RadioButton,
  RadioField,
  RadioGroup,
} from "react-aria-components";
import { cooldown } from "../../../cooldown";
import { Icon } from "../../../ui/icons";
import { addImage, mediaMessage } from "../media";
import { insertAt, plainText } from "../model";
import { RichField } from "../RichField";

/**
 * Takes the removal of a list item: `remove` takes it out, `restore` puts it
 * back where it was, and `text` says what was removed, for the toast that
 * offers to undo it.
 */
export type RemoveItem = (
  text: string,
  remove: () => void,
  restore: () => void,
) => void;

/** The accessible names and toast text of the items in a list, by item index. */
export interface ItemNames {
  /** Names the item's field and is its placeholder. */
  field: (i: number) => string;
  image: (i: number) => string;
  imageRemove: (i: number) => string;
  remove: (i: number) => string;
  removed: (i: number) => string;
  /** With `down`, gives every item buttons that move it one place. */
  up?: (i: number) => string;
  down?: (i: number) => string;
}

/**
 * Returns the names of a list whose item `i` is called `label(i)`, in the
 * order a teacher sees. Without `movable` they leave out the names of the
 * move buttons, and so the list has none.
 */
export function itemNames(
  label: (i: number) => string,
  movable = true,
): ItemNames {
  const item = (i: number) => ({ item: label(i) });
  return {
    field: label,
    image: (i) => m.builder_item_image(item(i)),
    imageRemove: (i) => m.builder_item_image_remove(item(i)),
    remove: (i) => m.builder_item_delete(item(i)),
    removed: (i) => m.builder_item_removed(item(i)),
    up: movable ? (i) => m.builder_item_up(item(i)) : undefined,
    down: movable ? (i) => m.builder_item_down(item(i)) : undefined,
  };
}

/**
 * The picture controls of an option or target: a thumbnail with a × that
 * removes it (when there is one), and a button that picks an image file. The
 * picture is set through `onChange` only once it is uploaded; a failure leaves
 * the item as it was, and `onError` gets its message, or an empty string when
 * a new pick starts.
 */
export function ItemImage(props: {
  image: Option["image"];
  addLabel: string;
  removeLabel: string;
  onChange: (image: Option["image"]) => void;
  onError: (message: string) => void;
}) {
  const { image } = props;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    props.onError("");
    try {
      props.onChange(await addImage(file));
    } catch (err) {
      props.onError(mediaMessage(err));
    }
  };
  return (
    <>
      {image && (
        <span className="b-opt-pic">
          <MediaImage
            src={image.src}
            w={image.w}
            h={image.h}
            className="b-opt-thumb"
          />
          <Button
            className="t-icon-btn b-opt-pic-x"
            data-variant="danger"
            aria-label={props.removeLabel}
            onPress={() => props.onChange(undefined)}
          >
            <Icon name="close" />
          </Button>
        </span>
      )}
      <FileTrigger
        acceptedFileTypes={["image/*"]}
        onSelect={(files) => void pick(files?.[0])}
      >
        <Button className="t-icon-btn b-opt-img" aria-label={props.addLabel}>
          <Icon name="image" />
        </Button>
      </FileTrigger>
    </>
  );
}

/**
 * The rows of options or targets of one question. Each row is an inline rich
 * field with an image button, a thumbnail with a × that removes the picture,
 * a delete button, and, when `names` has `up` and `down`, buttons that move the
 * row and a handle that drags it to another row's place. The handle is for
 * the pointer only; the buttons are the keyboard's way to move a row.
 * `leading` and `trailing` put the type's own controls before the field and
 * before the delete button.
 *
 * Enter in a field moves to the next row if that one is empty and adds a row
 * after it otherwise; Backspace in an empty field removes the row and moves to
 * the one before. No row is added past `max` or removed below `min`. Every edit
 * goes through `onChange` as a function of the newest list; removing a row goes
 * through `onRemoveItem`, which owns the undo. A picture is set only once it is
 * uploaded, so a failure leaves the row as it was and shows a message under
 * the list. Without `addLabel` the list has no button that adds a row.
 */
export function ItemList<T extends Option | Target>(props: {
  items: T[];
  names: ItemNames;
  addLabel?: string;
  create: () => T;
  onChange: (fn: (items: T[]) => T[]) => void;
  onRemoveItem: RemoveItem;
  leading?: (item: T, index: number) => ReactNode;
  trailing?: (item: T, index: number) => ReactNode;
  marked?: (item: T) => boolean;
  min?: number;
  max?: number;
}) {
  const { items, names, onChange } = props;
  const min = props.min ?? 0;
  const max = props.max ?? Number.POSITIVE_INFINITY;
  const list = useRef<HTMLUListElement>(null);
  // The item to focus, bumped on each request so a repeat still moves focus.
  const [focus, setFocus] = useState({ id: "", n: 0 });
  // The button to focus after a move, which reorders the DOM and drops focus.
  const [moved, setMoved] = useState({ id: "", dir: "up", n: 0 });
  // Once a row is gone, the row that slides under the pointer can't take the
  // second click of a double-click.
  const [mayDelete] = useState(() => cooldown());
  const [imageError, setImageError] = useState("");
  // The row being dragged by its handle, and the row it is over.
  const dragged = useRef("");
  const [over, setOver] = useState("");
  const focusOn = (id: string) => setFocus((f) => ({ id, n: f.n + 1 }));

  useEffect(() => {
    if (!moved.n) return;
    const row = `[data-item="${CSS.escape(moved.id)}"]`;
    const other = moved.dir === "up" ? "down" : "up";
    (
      list.current?.querySelector<HTMLElement>(
        `${row} [data-move="${moved.dir}"]:not([disabled])`,
      ) ??
      list.current?.querySelector<HTMLElement>(
        `${row} [data-move="${other}"]:not([disabled])`,
      )
    )?.focus();
  }, [moved]);

  const setImage = (id: string, image: T["image"]) =>
    onChange((xs) => xs.map((x) => (x.id === id ? { ...x, image } : x)));

  const addAfter = (index: number) => {
    if (items.length >= max) return;
    const item = props.create();
    onChange((xs) => [...xs.slice(0, index + 1), item, ...xs.slice(index + 1)]);
    focusOn(item.id);
  };

  // Enter moves on to an empty next row rather than adding one before it.
  const enterFrom = (index: number) => {
    const next = items[index + 1];
    if (next && !plainText(next.content)) focusOn(next.id);
    else addAfter(index);
  };

  const remove = (index: number, moveFocus: boolean) => {
    if (items.length <= min) return;
    const gone = items[index];
    const near = items[index - 1] ?? items[index + 1];
    props.onRemoveItem(
      names.removed(index),
      () => onChange((xs) => xs.filter((x) => x.id !== gone.id)),
      () => onChange((xs) => insertAt(xs, index, gone)),
    );
    if (moveFocus && near) focusOn(near.id);
  };

  const move = (id: string, by: -1 | 1) => {
    onChange((xs) => {
      const i = xs.findIndex((x) => x.id === id);
      if (i < 0 || i + by < 0 || i + by >= xs.length) return xs;
      const out = [...xs];
      [out[i], out[i + by]] = [out[i + by], out[i]];
      return out;
    });
    setMoved((s) => ({ id, dir: by < 0 ? "up" : "down", n: s.n + 1 }));
  };

  /** Puts the dragged row where row `id` is. */
  const drop = (id: string) => {
    const from = dragged.current;
    dragged.current = "";
    setOver("");
    if (!from || from === id) return;
    onChange((xs) => {
      const i = xs.findIndex((x) => x.id === from);
      const j = xs.findIndex((x) => x.id === id);
      if (i < 0 || j < 0) return xs;
      const out = [...xs];
      out.splice(j, 0, ...out.splice(i, 1));
      return out;
    });
  };

  const movable = names.up && names.down;
  return (
    <>
      <ul className="b-opts" ref={list}>
        {items.map((o, i) => (
          <li
            key={o.id}
            className="b-opt"
            data-item={o.id}
            data-correct={props.marked?.(o) || undefined}
            data-over={over === o.id || undefined}
            onDragOver={
              movable
                ? (e) => {
                    if (!dragged.current) return;
                    e.preventDefault();
                    setOver(o.id);
                  }
                : undefined
            }
            onDrop={
              movable
                ? (e) => {
                    if (!dragged.current) return;
                    e.preventDefault();
                    drop(o.id);
                  }
                : undefined
            }
          >
            {movable && (
              <span
                className="b-opt-grip"
                data-grip
                draggable
                aria-hidden="true"
                onDragStart={(e) => {
                  dragged.current = o.id;
                  // A type of our own: the rich fields read the text types of a drop.
                  e.dataTransfer.setData("application/x-klats-item", o.id);
                  e.dataTransfer.effectAllowed = "move";
                  const row = e.currentTarget.closest("li");
                  if (row) e.dataTransfer.setDragImage(row, 0, 0);
                }}
                onDragEnd={() => {
                  dragged.current = "";
                  setOver("");
                }}
              >
                <Icon name="grip" />
              </span>
            )}
            {props.leading?.(o, i)}
            <RichField
              inline
              value={o.content}
              onChange={(doc) =>
                onChange((xs) =>
                  xs.map((x) => (x.id === o.id ? { ...x, content: doc } : x)),
                )
              }
              label={names.field(i)}
              placeholder={names.field(i)}
              focus={focus.id === o.id ? focus.n : 0}
              onEnter={() => enterFrom(i)}
              onEmptyBackspace={() => remove(i, true)}
            />
            <ItemImage
              image={o.image}
              addLabel={names.image(i)}
              removeLabel={names.imageRemove(i)}
              onChange={(image) => setImage(o.id, image)}
              onError={setImageError}
            />
            {movable && (
              <>
                <Button
                  className="t-icon-btn b-opt-move"
                  data-move="up"
                  aria-label={names.up?.(i)}
                  isDisabled={i === 0}
                  onPress={() => move(o.id, -1)}
                >
                  <Icon name="up" />
                </Button>
                <Button
                  className="t-icon-btn b-opt-move"
                  data-move="down"
                  aria-label={names.down?.(i)}
                  isDisabled={i === items.length - 1}
                  onPress={() => move(o.id, 1)}
                >
                  <Icon name="down" />
                </Button>
              </>
            )}
            {props.trailing?.(o, i)}
            <Button
              className="t-icon-btn b-opt-del"
              data-variant="danger"
              aria-label={names.remove(i)}
              isDisabled={items.length <= min}
              onPress={() => mayDelete() && remove(i, false)}
            >
              <Icon name="close" />
            </Button>
          </li>
        ))}
      </ul>
      {imageError && (
        <p className="b-rich-err" role="alert">
          {imageError}
        </p>
      )}
      {props.addLabel && (
        <Button
          className="t-btn b-add-opt"
          data-variant="dashed"
          isDisabled={items.length >= max}
          onPress={() => addAfter(items.length - 1)}
        >
          <Icon name="plus" />
          {props.addLabel}
        </Button>
      )}
    </>
  );
}

/**
 * A row's one-of-several control: radio chips named by `choices`, in a group
 * named `label`. `value` is the chosen id, or empty for none.
 */
export function RowChoice(props: {
  label: string;
  value: string;
  choices: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <RadioGroup
      className="b-rc"
      aria-label={props.label}
      orientation="horizontal"
      value={props.value || null}
      onChange={props.onChange}
    >
      {props.choices.map((c) => (
        <RadioField key={c.id} value={c.id}>
          <RadioButton className="b-rc-chip">{c.name}</RadioButton>
        </RadioField>
      ))}
    </RadioGroup>
  );
}
