import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Answer } from "../generated/testfmt";
import type { StudentQuestion } from "../generated/wire";
import { m } from "../paraglide/messages.js";
import type { MessagePart } from "../paraglide/runtime.js";
import { chipText } from "../questionTypes";
import { RichView } from "../rich/RichView";
import { AnswerArea } from "./answers/AnswerArea";
import { BADGE_LETTERS } from "./badges";
import { countBelow } from "./layout";
import { popIn, sheet } from "./motion";
import "./student-ui.css";
import "./QuestionSheet.css";

export interface QuestionSheetProps {
  /** Question number, from 1. */
  number: number;
  total: number;
  question: StudentQuestion;
  answer?: Answer;
  /** Called with the whole new answer. Left out where nothing can be answered. */
  onChange?: (answer: Answer) => void;
  readOnly?: boolean;
  /** Buttons for the sheet's footer, such as Skip and Next. */
  children?: ReactNode;
}

/**
 * One question on the white sheet: its number, the chip that says how to
 * answer, the text and the answer area of the question's type (see
 * {@link AnswerArea}).
 *
 * What overflows scrolls while the footer stays in place, with a fade and a
 * «Ще N відповіді нижче» button over the cut edge until the last element
 * marked `data-more-item` is in view. Pressing the button scrolls on and
 * keeps focus on the first element it revealed. Key presses are the caller's
 * to handle; for single and multiple choice the footer names the keys.
 */
export function QuestionSheet(props: QuestionSheetProps) {
  const { number, total, question } = props;
  const reduced = useReducedMotionConfig();
  const textId = useId();
  const chipId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  // The first item the cue revealed, which takes focus if the cue goes away.
  const revealed = useRef<HTMLElement | null>(null);
  const [density, setDensity] = useState(0);
  const [below, setBelow] = useState(0);
  const behavior = reduced ? "auto" : "smooth";

  // Pressing the cue can scroll it out of existence; keep focus off the body.
  useLayoutEffect(() => {
    const item = revealed.current;
    if (below > 0 || !item) return;
    revealed.current = null;
    if (moreRef.current?.contains(document.activeElement)) {
      item.querySelector("input")?.focus({ preventScroll: true });
    }
  }, [below]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const body = bodyRef.current;
    if (!scroller || !body) return;
    const update = () => setBelow(itemsBelow(scroller).length);
    // The body changes size when the answer area refits or a picture loads.
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    ro.observe(body);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, []);

  const keys =
    question.type === "single" || question.type === "multi"
      ? Math.min(question.options.length, BADGE_LETTERS.length)
      : 0;

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
          <div className="k-sheet-body" ref={bodyRef}>
            <span className="k-chip" id={chipId}>
              {chipText(question.type)}
            </span>
            <div className="k-qtext" id={textId}>
              <RichView doc={question.text} />
            </div>
            <AnswerArea
              question={question}
              answer={props.answer}
              onChange={props.onChange}
              readOnly={props.readOnly}
              labelledBy={textId}
              describedBy={chipId}
              onDensity={setDensity}
            />
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
                  revealed.current = itemsBelow(scroller)[0] ?? null;
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

/** Returns the `data-more-item` elements that are not fully in the visible part of `scroller`. */
function itemsBelow(scroller: HTMLElement): HTMLElement[] {
  const items = Array.from(
    scroller.querySelectorAll<HTMLElement>("[data-more-item]"),
  );
  // Layout offsets, not client rects, so the sheet's entry rotation can't skew them.
  const bottoms = items.map((item) => {
    let bottom = item.offsetHeight;
    for (
      let n: HTMLElement | null = item;
      n && n !== scroller;
      n = n.offsetParent as HTMLElement | null
    ) {
      bottom += n.offsetTop;
    }
    return bottom;
  });
  const visibleBottom = scroller.scrollTop + scroller.clientHeight;
  const first = bottoms.length - countBelow(bottoms, visibleBottom);
  return items.slice(first);
}
