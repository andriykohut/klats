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
import { flushSync } from "react-dom";
import type { Image } from "../generated/testfmt";
import { m } from "../paraglide/messages.js";
import type { MessagePart } from "../paraglide/runtime.js";
import { type RichDoc, RichView } from "../rich/RichView";
import { AnswerTile, TileFace } from "./AnswerTile";
import { BADGE_LETTERS } from "./badges";
import { chooseLayout, countBelow, nextDensity } from "./layout";
import { popIn, sheet } from "./motion";
import "./student-ui.css";
import "./QuestionSheet.css";

export interface QuestionSheetProps {
  /** Question number, from 1. */
  number: number;
  total: number;
  text: RichDoc;
  options: { id: string; content: RichDoc; image?: Image }[];
  multi: boolean;
  /** Selected option ids. */
  selected: string[];
  onChange: (optionIds: string[]) => void;
  /** Buttons for the sheet's footer, such as Skip and Next. */
  children?: ReactNode;
}

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
  const moreRef = useRef<HTMLDivElement>(null);
  // The first tile the cue revealed, which takes focus if the cue goes away.
  const revealed = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState<"grid" | "rows">("grid");
  const [density, setDensity] = useState(0);
  // "lines" measures line counts, "fit" steps density up until nothing
  // overflows, "done" leaves the result on screen.
  const [phase, setPhase] = useState<"lines" | "fit" | "done">("lines");
  const [below, setBelow] = useState(0);
  const optionsKey = JSON.stringify(options);
  const hasImages = options.some((o) => o.image);
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
      setLayout(chooseLayout(options.length, lines, hasImages));
      setPhase("fit");
    } else if (phase === "fit") {
      const next = nextDensity(
        scroller.scrollHeight,
        scroller.clientHeight,
        density,
      );
      if (next === null) setPhase("done");
      else setDensity(next);
    } else {
      setBelow(tilesBelow(scroller).length);
    }
  }, [phase, density, options.length, hasImages]);

  // Pressing the cue can scroll it out of existence; keep focus off the body.
  useLayoutEffect(() => {
    const tile = revealed.current;
    if (below > 0 || !tile) return;
    revealed.current = null;
    if (moreRef.current?.contains(document.activeElement)) {
      tile.querySelector("input")?.focus({ preventScroll: true });
    }
  }, [below]);

  useEffect(() => {
    const scroller = scrollRef.current;
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
    const onScroll = () => setBelow(tilesBelow(scroller).length);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    document.fonts.addEventListener("loadingdone", refit);
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      document.fonts.removeEventListener("loadingdone", refit);
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
      image={o.image}
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
        <div
          className="k-more"
          ref={moreRef}
          data-show={below > 0 || undefined}
          // A leaving button must not take focus while it fades out.
          inert={below === 0 || undefined}
        >
          <AnimatePresence>
            {below > 0 && (
              <motion.button
                type="button"
                className="k-more-button"
                onClick={() => {
                  const scroller = scrollRef.current;
                  if (!scroller) return;
                  revealed.current = tilesBelow(scroller)[0] ?? null;
                  scroller.scrollBy({
                    top: scroller.clientHeight * 0.8,
                    behavior,
                  });
                }}
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

/** Returns the answer tiles that are not fully in the visible part of `scroller`. */
function tilesBelow(scroller: HTMLElement): HTMLElement[] {
  const tiles = Array.from(
    scroller.querySelectorAll<HTMLElement>(".k-tile-wrap"),
  );
  // Layout offsets, not client rects, so the sheet's entry rotation can't skew them.
  const bottoms = tiles.map((tile) => {
    let bottom = tile.offsetHeight;
    for (
      let n: HTMLElement | null = tile;
      n && n !== scroller;
      n = n.offsetParent as HTMLElement | null
    ) {
      bottom += n.offsetTop;
    }
    return bottom;
  });
  const visibleBottom = scroller.scrollTop + scroller.clientHeight;
  const first = bottoms.length - countBelow(bottoms, visibleBottom);
  return tiles.slice(first);
}
