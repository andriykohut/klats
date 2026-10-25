import type { Option, Target } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "react-aria-components";
import { cooldown } from "../../../cooldown";
import { Icon } from "../../../ui/icons";
import { movePoint } from "../areas";
import { insertAt, MAX_LIST, newOption, newTarget } from "../model";
import { RichField } from "../RichField";
import { ItemImage, ItemList, itemNames } from "./ItemList";
import { fractionAt, PictureField, trackDrag } from "./PictureField";
import type { EditorProps } from "./QuestionEditor";

const DECOYS = itemNames(
  (i) => m.builder_label_decoy({ number: i + 1 }),
  false,
);

/** How far an arrow key moves the selected point, as a fraction of the picture. */
const STEP = 0.01;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-STEP, 0],
  ArrowRight: [STEP, 0],
  ArrowUp: [0, -STEP],
  ArrowDown: [0, STEP],
};

/**
 * The picture of a labelling question, its points and its labels. A click on
 * the picture, or «Додати точку» (at the centre), adds a numbered point and
 * the label that belongs to it; a point is a button that drags, and moves by
 * 1% with the arrow keys while it has focus. Each point owns its label (an
 * option that targets it), so no point can hold two. The question's `options`
 * are those labels and the extra ones that target nothing; at most
 * {@link MAX_LIST} labels in all, so at most that many points. Removing a
 * point removes its label, and an undo gives both back.
 */
export function LabelEditor(props: EditorProps) {
  const { question: q, onChange, onRemoveItem } = props;
  const points = q.targets ?? [];
  const box = useRef<HTMLFieldSetElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // What takes focus, bumped on each request so a repeat still moves focus: a
  // point's pin, a point's label field, or «Додати точку».
  const [focus, setFocus] = useState<{
    on: "pin" | "label" | "add";
    id: string;
    n: number;
  }>({ on: "pin", id: "", n: 0 });
  const [imageError, setImageError] = useState("");
  const [mayDelete] = useState(() => cooldown());
  // A click that ends a drag of a point must not put a new one.
  const dragged = useRef(false);
  const full = points.length >= MAX_LIST || q.options.length >= MAX_LIST;
  const point = (i: number) => m.point_label({ number: i + 1 });

  useEffect(() => {
    if (!focus.n) return;
    const id = CSS.escape(focus.id);
    (focus.on === "add"
      ? addButton.current
      : focus.on === "pin"
        ? box.current?.querySelector<HTMLElement>(`[data-pin="${id}"]`)
        : list.current?.querySelector<HTMLElement>(
            `[data-item="${id}"] [role="textbox"]`,
          )
    )?.focus();
  }, [focus]);

  const addPoint = (x: number, y: number) => {
    if (full) return;
    const t: Target = { ...newTarget(), x, y };
    const o: Option = { ...newOption(), target: t.id };
    onChange((x) =>
      (x.targets ?? []).length >= MAX_LIST || x.options.length >= MAX_LIST
        ? x
        : {
            ...x,
            targets: [...(x.targets ?? []), t],
            options: [...x.options, o],
          },
    );
    setFocus((f) => ({ on: "pin", id: t.id, n: f.n + 1 }));
  };

  const editPoint = (id: string, patch: Partial<Target>) =>
    onChange((x) => ({
      ...x,
      targets: (x.targets ?? []).map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }));

  const editLabel = (id: string, patch: Partial<Option>) =>
    onChange((x) => ({
      ...x,
      options: x.options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));

  const grab = (e: PointerEvent<HTMLButtonElement>, t: Target) => {
    if (e.button !== 0 || !box.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    trackDrag(
      e,
      box.current,
      (from, to) => editPoint(t.id, movePoint(t, to.x - from.x, to.y - from.y)),
      (moved) => {
        dragged.current = moved;
        setTimeout(() => {
          dragged.current = false;
        });
      },
    );
  };

  const nudge = (e: KeyboardEvent, t: Target) => {
    const step = ARROWS[e.key];
    if (!step || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    editPoint(t.id, movePoint(t, step[0], step[1]));
  };

  const removePoint = (index: number) => {
    const gone = points[index];
    const label = q.options.find((o) => o.target === gone.id);
    const labelIndex = label ? q.options.indexOf(label) : -1;
    const near = points[index - 1] ?? points[index + 1];
    setFocus((f) => ({
      on: near ? "label" : "add",
      id: near?.id ?? "",
      n: f.n + 1,
    }));
    onRemoveItem(
      m.builder_item_removed({ item: point(index) }),
      () =>
        onChange((x) => ({
          ...x,
          targets: (x.targets ?? []).filter((t) => t.id !== gone.id),
          options: x.options.filter((o) => o.target !== gone.id),
        })),
      () =>
        onChange((x) => ({
          ...x,
          targets: insertAt(x.targets ?? [], index, gone),
          options: label ? insertAt(x.options, labelIndex, label) : x.options,
        })),
    );
  };

  const decoys = q.options.filter((o) => !o.target);
  return (
    <>
      <PictureField
        {...props}
        boxRef={box}
        boxProps={{
          onClick: (e) => {
            if (dragged.current || !box.current) return;
            const at = movePoint(fractionAt(box.current, e), 0, 0);
            addPoint(at.x, at.y);
          },
        }}
      >
        {points.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="b-pin"
            data-pin={t.id}
            aria-label={point(i)}
            style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
            onPointerDown={(e) => grab(e, t)}
            // A click on a point is not a click on the picture.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => nudge(e, t)}
          >
            {i + 1}
          </button>
        ))}
      </PictureField>
      {q.image && (
        <>
          <div className="b-lbl">
            {m.builder_points()}
            <em>{m.builder_points_hint()}</em>
          </div>
          <ul className="b-opts" ref={list}>
            {points.map((t, i) => {
              const label = q.options.find((o) => o.target === t.id);
              const name = m.builder_point_label({ number: i + 1 });
              return (
                <li key={t.id} className="b-opt" data-item={t.id}>
                  <span className="b-area-no" aria-hidden="true">
                    {i + 1}
                  </span>
                  {label && (
                    <>
                      <RichField
                        inline
                        value={label.content}
                        onChange={(content) => editLabel(label.id, { content })}
                        label={name}
                        placeholder={name}
                      />
                      <ItemImage
                        image={label.image}
                        addLabel={m.builder_item_image({ item: name })}
                        removeLabel={m.builder_item_image_remove({
                          item: name,
                        })}
                        onChange={(image) => editLabel(label.id, { image })}
                        onError={setImageError}
                      />
                    </>
                  )}
                  <Button
                    className="t-icon-btn b-opt-del"
                    data-variant="danger"
                    aria-label={m.builder_item_delete({ item: point(i) })}
                    onPress={() => mayDelete() && removePoint(i)}
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
            ref={addButton}
            className="t-btn b-add-opt"
            data-variant="dashed"
            isDisabled={full}
            onPress={() => addPoint(0.5, 0.5)}
          >
            <Icon name="plus" />
            {m.builder_add_point()}
          </Button>
        </>
      )}

      <div className="b-lbl">
        {m.builder_label_decoys()}
        <em>{m.builder_label_decoys_hint()}</em>
      </div>
      <ItemList
        items={decoys}
        names={DECOYS}
        addLabel={m.builder_add_label_decoy()}
        create={newOption}
        max={MAX_LIST - points.length}
        onChange={(fn) =>
          onChange((x) => ({
            ...x,
            options: [
              ...x.options.filter((o) => o.target),
              ...fn(x.options.filter((o) => !o.target)),
            ],
          }))
        }
        onRemoveItem={onRemoveItem}
      />
    </>
  );
}
