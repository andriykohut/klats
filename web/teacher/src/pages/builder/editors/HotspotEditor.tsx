import type { Area } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  NumberField,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import { cooldown } from "../../../cooldown";
import { Icon } from "../../../ui/icons";
import { areaFromDrag, moveArea, setAreaField } from "../areas";
import { insertAt, MAX_LIST } from "../model";
import { PictureField, trackDrag } from "./PictureField";
import type { EditorProps } from "./QuestionEditor";

type Shape = "rect" | "ellipse";
type Field = "x" | "y" | "w" | "h";

const FIELDS: [Field, (a: { number: number }) => string][] = [
  ["x", m.builder_area_x],
  ["y", m.builder_area_y],
  ["w", m.builder_area_w],
  ["h", m.builder_area_h],
];

const place = (a: Area) => ({
  left: `${a.x * 100}%`,
  top: `${a.y * 100}%`,
  width: `${a.w * 100}%`,
  height: `${a.h * 100}%`,
});

/**
 * The picture of a hotspot question and the areas on it. Dragging across the
 * picture draws an area of the chosen shape, up to {@link MAX_LIST} of them,
 * and dragging an area moves it. Under the picture each area has its X, Y,
 * width and height as percentages of the picture, which are the keyboard's way
 * to place and size one; every move, draw and typed number keeps the area
 * inside the picture (see internal/testfmt). Removing an area or the picture
 * goes through `onRemoveItem`.
 */
export function HotspotEditor(props: EditorProps) {
  const { question: q, onChange, onRemoveItem } = props;
  const areas = q.areas ?? [];
  const box = useRef<HTMLFieldSetElement>(null);
  const [shape, setShape] = useState<Shape>("rect");
  const [draft, setDraft] = useState<Area | null>(null);
  const [mayDelete] = useState(() => cooldown());
  const list = useRef<HTMLUListElement>(null);
  // The area whose X field takes focus, bumped on each request.
  const [focus, setFocus] = useState({ id: "", n: 0 });

  useEffect(() => {
    if (focus.n) {
      list.current
        ?.querySelector<HTMLElement>(
          `[data-item="${CSS.escape(focus.id)}"] input`,
        )
        ?.focus();
    }
  }, [focus]);

  const edit = (id: string, fn: (a: Area) => Area) =>
    onChange((x) => ({
      ...x,
      areas: (x.areas ?? []).map((a) => (a.id === id ? fn(a) : a)),
    }));

  const append = (area: Area) =>
    onChange((x) =>
      (x.areas ?? []).length >= MAX_LIST
        ? x
        : { ...x, areas: [...(x.areas ?? []), area] },
    );

  const draw = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || areas.length >= MAX_LIST || !box.current) return;
    e.preventDefault();
    let drawn: Area | null = null;
    trackDrag(
      e,
      box.current,
      (from, to) => {
        drawn = areaFromDrag(from, to, shape);
        setDraft(drawn);
      },
      (dragged) => {
        setDraft(null);
        if (dragged && drawn) append(drawn);
      },
    );
  };

  // The keyboard's way to make an area: one at the centre, for its fields to place.
  const addCentred = () => {
    const area = areaFromDrag({ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }, shape);
    append(area);
    setFocus((f) => ({ id: area.id, n: f.n + 1 }));
  };

  const grab = (e: PointerEvent<HTMLElement>, area: Area) => {
    if (e.button !== 0 || !box.current) return;
    e.preventDefault();
    e.stopPropagation();
    trackDrag(
      e,
      box.current,
      (from, to) =>
        edit(area.id, () => moveArea(area, to.x - from.x, to.y - from.y)),
      () => {},
    );
  };

  const remove = (index: number) => {
    const gone = areas[index];
    onRemoveItem(
      m.builder_item_removed({ item: m.builder_area({ number: index + 1 }) }),
      () =>
        onChange((x) => ({
          ...x,
          areas: (x.areas ?? []).filter((a) => a.id !== gone.id),
        })),
      () =>
        onChange((x) => ({
          ...x,
          areas: insertAt(x.areas ?? [], index, gone),
        })),
    );
  };

  return (
    <>
      <PictureField {...props} boxRef={box} boxProps={{ onPointerDown: draw }}>
        {areas.map((a, i) => (
          <div
            key={a.id}
            className="b-area"
            data-shape={a.shape}
            style={place(a)}
            onPointerDown={(e) => grab(e, a)}
          >
            <span className="b-area-n" aria-hidden="true">
              {i + 1}
            </span>
          </div>
        ))}
        {draft && (
          <div
            className="b-area"
            data-shape={draft.shape}
            data-draft
            style={place(draft)}
          />
        )}
      </PictureField>
      {q.image && (
        <>
          <div className="b-lbl">
            {m.builder_areas()}
            <em>{m.builder_areas_hint()}</em>
          </div>
          <ToggleButtonGroup
            className="b-seg"
            aria-label={m.builder_shape()}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[shape]}
            onSelectionChange={(keys) => {
              const [next] = keys;
              if (next) setShape(next as Shape);
            }}
          >
            <ToggleButton id="rect" className="b-seg-btn">
              {m.builder_shape_rect()}
            </ToggleButton>
            <ToggleButton id="ellipse" className="b-seg-btn">
              {m.builder_shape_ellipse()}
            </ToggleButton>
          </ToggleButtonGroup>
          <ul className="b-opts" ref={list}>
            {areas.map((a, i) => (
              <li key={a.id} className="b-opt b-area-row" data-item={a.id}>
                <span className="b-area-no" aria-hidden="true">
                  {i + 1}
                </span>
                {FIELDS.map(([field, name]) => (
                  <div key={field} className="b-pct">
                    <span aria-hidden="true">{field.toUpperCase()}</span>
                    <NumberField
                      aria-label={name({ number: i + 1 })}
                      minValue={0}
                      maxValue={100}
                      value={Math.round(a[field] * 100)}
                      formatOptions={{ maximumFractionDigits: 0 }}
                      onChange={(v) =>
                        Number.isNaN(v) ||
                        edit(a.id, (x) => setAreaField(x, field, v / 100))
                      }
                    >
                      <Input />
                    </NumberField>
                    <span aria-hidden="true">%</span>
                  </div>
                ))}
                <Button
                  className="t-icon-btn b-opt-del"
                  data-variant="danger"
                  aria-label={m.builder_item_delete({
                    item: m.builder_area({ number: i + 1 }),
                  })}
                  onPress={() => mayDelete() && remove(i)}
                >
                  <Icon name="close" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            className="t-btn b-add-opt"
            data-variant="dashed"
            isDisabled={areas.length >= MAX_LIST}
            onPress={addCentred}
          >
            <Icon name="plus" />
            {m.builder_add_area()}
          </Button>
        </>
      )}
    </>
  );
}
