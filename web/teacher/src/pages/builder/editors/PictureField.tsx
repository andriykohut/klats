import type { Point } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { MediaImage } from "@klats/shared/rich/RichView.tsx";
import {
  type ComponentProps,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useState,
} from "react";
import { Button, FileTrigger } from "react-aria-components";
import { Icon } from "../../../ui/icons";
import { addImage, mediaMessage } from "../media";
import type { EditorProps } from "./QuestionEditor";

/** The pixels a pointer must travel for a press to count as a drag. */
const DRAG_PIXELS = 4;

/** Returns where `e` is on `box`, as fractions of its size; they may fall outside 0 to 1. */
export function fractionAt(
  box: HTMLElement,
  e: { clientX: number; clientY: number },
): Point {
  const r = box.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top) / r.height,
  };
}

/**
 * Follows the pointer that pressed on `e.currentTarget` until it is released.
 * `onMove` gets where the press began and where the pointer is now, as
 * fractions of `box`; `onEnd` gets whether the pointer travelled far enough
 * to be a drag and was released rather than cancelled. The element keeps the
 * pointer meanwhile, so a drag that leaves it carries on.
 */
export function trackDrag(
  e: ReactPointerEvent<HTMLElement>,
  box: HTMLElement,
  onMove: (from: Point, to: Point) => void,
  onEnd: (dragged: boolean) => void,
): void {
  const el = e.currentTarget;
  const from = fractionAt(box, e);
  const [x0, y0] = [e.clientX, e.clientY];
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => onMove(from, fractionAt(box, ev));
  const end = (ev: PointerEvent) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    onEnd(
      ev.type === "pointerup" &&
        Math.hypot(ev.clientX - x0, ev.clientY - y0) >= DRAG_PIXELS,
    );
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/**
 * The picture of a hotspot or label question. Without one it is a place to
 * pick a file, drop one or paste one; with one it is the picture in a box of
 * its final shape from the first frame, with `children` laid over it and
 * `boxProps` on the box (the editor's pointer handlers), and a button that
 * removes it. The picture is set once it is uploaded, and a failure shows
 * its message under the field until the next try. Removing it goes through
 * `onRemoveItem`, so an undo brings it back.
 */
export function PictureField(
  props: EditorProps & {
    boxRef?: Ref<HTMLFieldSetElement>;
    boxProps?: ComponentProps<"fieldset">;
    children?: ReactNode;
  },
) {
  const { question: q, onChange } = props;
  const image = q.image;
  const [error, setError] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const picked = await addImage(file);
      onChange((x) => ({ ...x, image: picked }));
    } catch (err) {
      setError(mediaMessage(err));
    }
  };

  const remove = () =>
    props.onRemoveItem(
      m.builder_item_removed({ item: m.builder_picture() }),
      () => onChange((x) => ({ ...x, image: undefined })),
      () => onChange((x) => ({ ...x, image })),
    );

  return (
    <>
      <div className="b-lbl">{m.builder_picture()}</div>
      {image ? (
        <>
          <fieldset
            {...props.boxProps}
            ref={props.boxRef}
            className="b-pic"
            aria-label={m.builder_picture()}
            style={{
              aspectRatio: `${image.w} / ${image.h}`,
              width: `min(100%, ${image.w}px, ${(62 * image.w) / image.h}vh)`,
            }}
            // A picture dragged by the browser would take the pointer.
            onDragStart={(e) => e.preventDefault()}
          >
            <MediaImage
              className="b-pic-img"
              src={image.src}
              w={image.w}
              h={image.h}
            />
            {props.children}
          </fieldset>
          <Button className="b-link b-pic-x" onPress={remove}>
            {m.builder_picture_remove()}
          </Button>
        </>
      ) : (
        <fieldset
          className="b-drop"
          aria-label={m.builder_picture()}
          data-drop
          // Focusable by click, so a paste lands here; the button stays the tab stop.
          tabIndex={-1}
          onDragOver={(e) => e.preventDefault()}
          // The browser would open a dropped file in place of the builder.
          onDrop={(e) => {
            e.preventDefault();
            const file = [...e.dataTransfer.files].find((f) =>
              f.type.startsWith("image/"),
            );
            if (file) void pick(file);
          }}
          // A copied picture has no text; a copy from a document has both.
          onPaste={(e) => {
            const file = e.clipboardData.files[0];
            if (!file || e.clipboardData.getData("text/plain")) return;
            e.preventDefault();
            void pick(file);
          }}
        >
          <FileTrigger
            acceptedFileTypes={["image/*"]}
            onSelect={(files) => void pick(files?.[0])}
          >
            <Button className="t-btn" data-variant="dashed">
              <Icon name="image" />
              {m.builder_picture_add()}
            </Button>
          </FileTrigger>
          <span>{m.builder_picture_drop()}</span>
        </fieldset>
      )}
      {error && (
        <p className="b-rich-err" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
