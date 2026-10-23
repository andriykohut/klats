import type { Test } from "@klats/shared/generated/testfmt.ts";
import { applyPalette, type PaletteId } from "@klats/shared/palettes.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { QuestionSheet } from "@klats/shared/student-ui/QuestionSheet.tsx";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Icon } from "../../ui/icons";

/** The student screen the preview draws, in design pixels. */
const STAGE_WIDTH = 1280;

/**
 * The right column: the selected question as students will see it, and
 * under it `children` (the checks). Closed, the column narrows to the checks
 * and a button that opens the preview again.
 */
export function PreviewPane(props: {
  test: Test;
  palette: PaletteId;
  index: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <aside className="t-panel b-pv" aria-label={m.builder_preview()}>
      {props.open ? (
        <>
          <header className="b-pv-head">
            <h2>{m.builder_preview()}</h2>
            <Button className="b-link" onPress={() => props.onToggle(false)}>
              {m.builder_preview_hide()}
            </Button>
          </header>
          <Stage
            test={props.test}
            palette={props.palette}
            index={props.index}
          />
        </>
      ) : (
        <Button
          className="t-btn b-pv-show"
          data-variant="quiet"
          onPress={() => props.onToggle(true)}
        >
          <Icon name="eye" />
          {m.builder_preview_show()}
        </Button>
      )}
      {props.children}
    </aside>
  );
}

/**
 * The student screen at its 1280×720 design size, scaled down to the pane's
 * width. It is a size container, so the shared components' --k-px resolves
 * to 1 inside it, and it carries the test's palette, leaving the app's own
 * colours alone. It is inert: a picture, not a place to answer.
 */
function Stage({
  test,
  palette,
  index,
}: {
  test: Test;
  palette: PaletteId;
  index: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / STAGE_WIDTH);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (stage.current) applyPalette(stage.current, palette);
  }, [palette]);

  const q = test.questions[index];
  const total = test.questions.length;
  return (
    <div className="b-mini" ref={frame}>
      <div
        className="b-stage"
        ref={stage}
        inert
        style={{ transform: `scale(${scale})` }}
      >
        <div className="b-s-top">
          <span className="b-s-title">{test.title}</span>
          <span className="b-s-prog">
            {test.questions.map((x, i) => (
              <i
                key={x.id}
                className="b-s-seg"
                data-state={
                  i < index ? "done" : i === index ? "current" : undefined
                }
              />
            ))}
          </span>
          <span className="b-s-who">{m.builder_preview_student()}</span>
        </div>
        <div className="b-s-slot">
          {q && (
            <QuestionSheet
              key={q.id}
              number={index + 1}
              total={total}
              text={q.text}
              options={q.options.map((o) => ({ id: o.id, content: o.content }))}
              multi={q.type === "multi"}
              selected={[]}
              onChange={() => {}}
            >
              <span className="b-s-btn" data-quiet>
                <span className="b-s-face">{m.test_skip()}</span>
              </span>
              <span className="b-s-btn">
                <span className="b-s-face">
                  {index === total - 1 ? m.test_finish() : m.test_next()}
                </span>
              </span>
            </QuestionSheet>
          )}
        </div>
      </div>
    </div>
  );
}
