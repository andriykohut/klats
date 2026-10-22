import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CheckboxGroup } from "react-aria-components/CheckboxGroup";
import { RadioGroup } from "react-aria-components/RadioGroup";
import { m } from "../paraglide/messages.js";
import type { MessagePart } from "../paraglide/runtime.js";
import { type RichDoc, RichView } from "../rich/RichView";
import { AnswerTile, BADGE_LETTERS, TileFace } from "./AnswerTile";
import { chooseLayout } from "./layout";
import { popIn, sheet } from "./motion";
import "./student-ui.css";

export interface QuestionSheetProps {
  /** Question number, from 1. */
  number: number;
  total: number;
  text: RichDoc;
  options: { id: string; content: RichDoc }[];
  multi: boolean;
  /** Selected option ids. */
  selected: string[];
  onChange: (optionIds: string[]) => void;
  /** Buttons for the sheet's footer, such as Skip and Next. */
  children?: ReactNode;
}

/** Denser tile steps tried, in order, while the answers overflow the sheet. */
const DENSITIES = 3;

/**
 * One question on the white sheet: its number, the answer mode, the text and
 * the answer tiles. Tiles form a 2×2 grid when they fit (see
 * {@link chooseLayout}) and full-width rows otherwise. If the answers still
 * overflow, the sheet tightens tile padding and gaps, then the tile font
 * (never below the pixel floors). All of this is measured before the first
 * paint, and again when the sheet resizes or fonts load.
 *
 * What still overflows scrolls while the footer stays in place, with a fade
 * and a «Ще N відповіді нижче» button over the cut edge until the last tile
 * is in view. Selecting or focusing a tile scrolls it into view. Key presses
 * are the caller's to handle; the footer only names the keys.
 */
export function QuestionSheet(props: QuestionSheetProps) {
  const { number, total, text, options, multi, selected, onChange } = props;
  const reduced = useReducedMotionConfig();
  const textId = useId();
  const chipId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"grid" | "rows">("grid");
  const [density, setDensity] = useState(0);
  // "lines" measures line counts, "fit" steps density up until nothing
  // overflows, "done" leaves the result on screen.
  const [phase, setPhase] = useState<"lines" | "fit" | "done">("lines");
  const [below, setBelow] = useState(0);
  const optionsKey = JSON.stringify(options);
  const behavior = reduced ? "auto" : "smooth";

  const restart = useCallback(() => {
    setDensity(0);
    setPhase("lines");
  }, []);

  // Keyed on content, so a caller rebuilding the array costs no remeasure.
  useLayoutEffect(restart, [optionsKey]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
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
      setLayout(chooseLayout(options.length, lines));
      setPhase("fit");
    } else if (phase === "fit") {
      const overflows = scroller.scrollHeight > scroller.clientHeight + 1;
      if (overflows && density < DENSITIES - 1) setDensity(density + 1);
      else setPhase("done");
    } else {
      setBelow(tilesBelow(scroller));
    }
  }, [phase, density, options.length]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let size = "";
    const ro = new ResizeObserver(() => {
      const next = `${scroller.clientWidth}x${scroller.clientHeight}`;
      if (next !== size && size !== "") restart();
      size = next;
    });
    ro.observe(scroller);
    const onScroll = () => setBelow(tilesBelow(scroller));
    scroller.addEventListener("scroll", onScroll, { passive: true });
    document.fonts.addEventListener("loadingdone", restart);
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      document.fonts.removeEventListener("loadingdone", restart);
    };
  }, [restart]);

  // A tile picked by key may be off screen.
  const shown = useRef(selected);
  useEffect(() => {
    const added = selected.find((id) => !shown.current.includes(id));
    shown.current = selected;
    if (!added) return;
    scrollRef.current
      ?.querySelector(`[data-option="${CSS.escape(added)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior });
  }, [selected, behavior]);

  const tiles = options.map((o, i) => (
    <AnswerTile
      key={o.id}
      id={o.id}
      index={i}
      content={o.content}
      multi={multi}
    />
  ));
  const group = {
    className: `k-answers k-answers-${layout}`,
    "aria-labelledby": textId,
    "aria-describedby": chipId,
  };
  const keys = Math.min(options.length, BADGE_LETTERS.length);

  return (
    <motion.section
      className="k-sheet"
      data-density={density || undefined}
      {...sheet(reduced)}
    >
      <div className="k-sheet-main">
        <div className="k-sheet-scroll" ref={scrollRef}>
          <div>
            <div className={number >= 10 ? "k-num k-num-small" : "k-num"}>
              {number}
            </div>
            <div className="k-of">{m.of_total({ total })}</div>
          </div>
          <div className="k-sheet-body">
            <span className="k-chip" id={chipId}>
              {multi ? m.answer_multi() : m.answer_single()}
            </span>
            <div className="k-qtext" id={textId}>
              <RichView doc={text} />
            </div>
            {multi ? (
              <CheckboxGroup {...group} value={selected} onChange={onChange}>
                {tiles}
              </CheckboxGroup>
            ) : (
              <RadioGroup
                {...group}
                value={selected[0] ?? null}
                onChange={(id) => onChange([id])}
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
                  <TileFace
                    key={o.id}
                    index={i}
                    content={o.content}
                    multi={multi}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="k-more" data-show={below > 0 || undefined}>
          <AnimatePresence>
            {below > 0 && (
              <motion.button
                type="button"
                className="k-more-button"
                onClick={() =>
                  scrollRef.current?.scrollBy({
                    top: scrollRef.current.clientHeight * 0.8,
                    behavior,
                  })
                }
                {...popIn(0, reduced)}
                exit={{ opacity: 0, y: "20%" }}
              >
                {m.answers_below({ count: below })}
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 9.5l6 6 6-6" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="k-sheet-foot">
        {keys > 0 && (
          <div className="k-keys">
            {withKbd(
              m.keys_hint.parts({
                letters: `${BADGE_LETTERS[0]}–${BADGE_LETTERS[keys - 1]}`,
                digits: `1–${keys}`,
              }),
            )}
          </div>
        )}
        <div className="k-actions">{props.children}</div>
      </div>
    </motion.section>
  );
}

const ONE_LINE: RichDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "А" }] }],
};

/** Renders message parts, turning each {#kbd}…{/kbd} span into a key cap. */
function withKbd(parts: MessagePart[]): ReactNode[] {
  const out: ReactNode[] = [];
  let key: string | null = null;
  parts.forEach((part, i) => {
    if (part.type === "markup-start") key = "";
    else if (part.type === "markup-end") {
      out.push(<kbd key={i}>{key}</kbd>);
      key = null;
    } else if (part.type === "text") {
      if (key === null) out.push(part.value);
      else key += part.value;
    }
  });
  return out;
}

/** Counts the answer tiles that end below the visible part of `scroller`. */
function tilesBelow(scroller: HTMLElement): number {
  const visibleBottom = scroller.scrollTop + scroller.clientHeight + 1;
  let count = 0;
  for (const tile of scroller.querySelectorAll<HTMLElement>(".k-tile-wrap")) {
    // Layout offsets, not client rects, so the sheet's entry rotation can't skew them.
    let bottom = tile.offsetHeight;
    for (
      let n: HTMLElement | null = tile;
      n && n !== scroller;
      n = n.offsetParent as HTMLElement | null
    ) {
      bottom += n.offsetTop;
    }
    if (bottom > visibleBottom) count++;
  }
  return count;
}
