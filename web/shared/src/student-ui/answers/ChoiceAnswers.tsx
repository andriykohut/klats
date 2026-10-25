import { useReducedMotionConfig } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CheckboxGroup } from "react-aria-components/CheckboxGroup";
import { RadioGroup } from "react-aria-components/RadioGroup";
import { flushSync } from "react-dom";
import type { RichDoc } from "../../rich/RichView";
import { AnswerTile, TileFace } from "../AnswerTile";
import { chooseLayout, nextDensity } from "../layout";
import type { AnswerProps } from "./AnswerArea";

/**
 * The answer tiles of a single or multiple choice question. Tiles form a 2×2
 * grid when they fit (see {@link chooseLayout}) and full-width rows otherwise.
 * If the answers still overflow the sheet's scroller, it steps `density` up
 * through `onDensity`: tighter tile padding and gaps, then a smaller tile
 * font (never below the pixel floors). The sheet owns `density` and shows it
 * as `data-density`, which the stylesheets key on, so each step is measured
 * after it is on screen. All of this is measured before the first paint, and
 * again when the scroller resizes, fonts load or a picture loads or fails.
 *
 * Each tile is marked `data-more-item` for the sheet's overflow cue. Picking a
 * tile by key scrolls it into view.
 */
export function ChoiceAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
  density,
  onDensity,
}: AnswerProps & { density: number; onDensity: (density: number) => void }) {
  const { options } = question;
  const multi = question.type === "multi";
  const selected = answer?.items ?? [];
  const reduced = useReducedMotionConfig();
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"grid" | "rows">("grid");
  // "lines" measures line counts, "fit" steps density up until nothing
  // overflows, "done" leaves the result on screen.
  const [phase, setPhase] = useState<"lines" | "fit" | "done">("lines");
  const optionsKey = JSON.stringify(options);
  const hasImages = options.some((o) => o.image);

  const restart = useCallback(() => {
    onDensity(0);
    setPhase("lines");
  }, [onDensity]);

  // Keyed on content, so a caller rebuilding the array costs no remeasure.
  // Single and multiple choice share this component, so a builder preview that
  // switches between them refits as well.
  useLayoutEffect(restart, [optionsKey, question.type]);

  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>(".k-sheet-scroll");
    if (!scroller) return;
    if (phase === "lines") {
      const box = measureRef.current;
      if (!box) return;
      // The first face holds one letter, so its height is one line.
      const [probe, ...faces] = Array.from(
        box.querySelectorAll<HTMLElement>(".k-tile-text"),
      );
      const lines = faces.map((f) =>
        Math.round(f.offsetHeight / probe.offsetHeight),
      );
      setLayout(chooseLayout(options.length, lines, hasImages));
      setPhase("fit");
    } else if (phase === "fit") {
      const next = nextDensity(
        scroller.scrollHeight,
        scroller.clientHeight,
        density,
      );
      if (next === null) setPhase("done");
      else onDensity(next);
    }
  }, [phase, density, onDensity, options.length, hasImages]);

  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>(".k-sheet-scroll");
    if (!scroller) return;
    // Synchronous, so no frame paints at the old density.
    const refit = () => flushSync(restart);
    let size = "";
    const ro = new ResizeObserver(() => {
      const next = `${scroller.clientWidth}x${scroller.clientHeight}`;
      if (next !== size && size !== "") refit();
      size = next;
    });
    ro.observe(scroller);
    document.fonts.addEventListener("loadingdone", refit);
    // Load and error don't bubble. A picture that decodes, or that gives way
    // to a note, can change the content's height; the note renders only after
    // the error event has passed, hence the timer.
    const refitLater = () => setTimeout(refit);
    scroller.addEventListener("load", refit, true);
    scroller.addEventListener("error", refitLater, true);
    return () => {
      ro.disconnect();
      scroller.removeEventListener("load", refit, true);
      scroller.removeEventListener("error", refitLater, true);
      document.fonts.removeEventListener("loadingdone", refit);
    };
  }, [restart]);

  // A tile picked by key may be off screen.
  const shown = useRef(selected);
  useEffect(() => {
    const added = selected.find((id) => !shown.current.includes(id));
    shown.current = selected;
    if (!added) return;
    rootRef.current
      ?.querySelector(`[data-option="${CSS.escape(added)}"]`)
      ?.scrollIntoView({
        block: "nearest",
        behavior: reduced ? "auto" : "smooth",
      });
  }, [selected, reduced]);

  const tiles = options.map((o, i) => (
    <AnswerTile
      key={o.id}
      id={o.id}
      index={i}
      content={o.content}
      image={o.image}
      multi={multi}
    />
  ));
  const group = {
    className: `k-answers k-answers-${layout}`,
    "aria-labelledby": labelledBy,
    "aria-describedby": describedBy,
    isReadOnly: readOnly,
  };

  return (
    <div ref={rootRef}>
      {multi ? (
        <CheckboxGroup
          {...group}
          value={selected}
          onChange={(items) => onChange?.({ items })}
        >
          {tiles}
        </CheckboxGroup>
      ) : (
        <RadioGroup
          {...group}
          value={selected[0] ?? null}
          onChange={(id) => onChange?.({ items: [id] })}
        >
          {tiles}
        </RadioGroup>
      )}
      {phase === "lines" && (
        <div
          className="k-answers k-answers-grid k-measure"
          ref={measureRef}
          aria-hidden="true"
        >
          <TileFace index={0} content={ONE_LINE} multi={multi} />
          {options.map((o, i) => (
            <TileFace key={o.id} index={i} content={o.content} multi={multi} />
          ))}
        </div>
      )}
    </div>
  );
}

const ONE_LINE: RichDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "А" }] }],
};
