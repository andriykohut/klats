import { motion, useReducedMotionConfig } from "motion/react";
import {
  type ReactNode,
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
import { sheet } from "./motion";
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

/**
 * One question on the white sheet: its number, the answer mode, the text and
 * the answer tiles. Tiles form a 2×2 grid when they fit (see
 * {@link chooseLayout}) and full-width rows otherwise; the choice is measured
 * before the first paint, and again when the width changes or fonts load. The
 * body scrolls while the footer stays in place. Key presses are the caller's
 * to handle; the footer only names the keys.
 */
export function QuestionSheet(props: QuestionSheetProps) {
  const { number, total, text, options, multi, selected, onChange } = props;
  const reduced = useReducedMotionConfig();
  const textId = useId();
  const chipId = useId();
  const measureRef = useRef<HTMLDivElement>(null);
  // State rather than a ref, so the width observer follows the group when
  // `multi` swaps RadioGroup and CheckboxGroup.
  const [answers, setAnswers] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<"grid" | "rows">("grid");
  const [measuring, setMeasuring] = useState(true);
  const optionsKey = JSON.stringify(options);

  // Keyed on content, so a caller rebuilding the array costs no remeasure.
  useLayoutEffect(() => setMeasuring(true), [optionsKey]);

  useLayoutEffect(() => {
    const box = measureRef.current;
    if (!measuring || !box) return;
    // The first face holds one letter, so its height is one line.
    const [probe, ...faces] = Array.from(
      box.querySelectorAll<HTMLElement>(".k-tile-text"),
    );
    const lines = faces.map((f) =>
      Math.round(f.offsetHeight / probe.offsetHeight),
    );
    setLayout(chooseLayout(options.length, lines));
    setMeasuring(false);
  }, [measuring, options.length]);

  useEffect(() => {
    if (!answers) return;
    let width = answers.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (answers.offsetWidth === width) return;
      width = answers.offsetWidth;
      setMeasuring(true);
    });
    ro.observe(answers);
    const remeasure = () => setMeasuring(true);
    document.fonts.addEventListener("loadingdone", remeasure);
    return () => {
      ro.disconnect();
      document.fonts.removeEventListener("loadingdone", remeasure);
    };
  }, [answers]);

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
    ref: setAnswers,
    className: `k-answers k-answers-${layout}`,
    "aria-labelledby": textId,
    "aria-describedby": chipId,
  };
  const keys = Math.min(options.length, BADGE_LETTERS.length);

  return (
    <motion.section className="k-sheet" {...sheet(reduced)}>
      <div className="k-sheet-scroll">
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
          {measuring && (
            <div
              className="k-answers k-answers-grid k-measure"
              ref={measureRef}
              aria-hidden="true"
            >
              <TileFace index={0} content={ONE_LINE} />
              {options.map((o, i) => (
                <TileFace key={o.id} index={i} content={o.content} />
              ))}
            </div>
          )}
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
