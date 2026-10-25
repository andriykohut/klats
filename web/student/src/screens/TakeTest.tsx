import { isAnswered } from "@klats/shared/answers.ts";
import type { Answer } from "@klats/shared/generated/testfmt.ts";
import type { StudentTest } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { QuestionSheet } from "@klats/shared/student-ui/QuestionSheet.tsx";
import { useIsPresent } from "motion/react";
import { useEffect } from "react";
import { keyToOption } from "../input/keyboard";

/**
 * One question of the test on its sheet, with Skip and Next (Finish on the
 * last question, which leads to the review). Next waits for an answer; Skip
 * never does. For single and multiple choice, keys pick answers (see
 * {@link keyToOption}). Enter means Next, except while a text field other than
 * a one-line answer field (marked `data-enter-next`) or the question grid has
 * focus.
 */
export function TakeTest({
  test,
  index,
  answers,
  onAnswer,
  onGo,
  onReview,
}: {
  test: StudentTest;
  index: number;
  answers: Record<string, Answer>;
  onAnswer: (questionId: string, answer: Answer) => void;
  onGo: (index: number) => void;
  onReview: () => void;
}) {
  const q = test.questions[index];
  const multi = q.type === "multi";
  const keyed = multi || q.type === "single";
  const selected = answers[q.id]?.items ?? [];
  const answered = isAnswered(q, answers[q.id]);
  const last = index === test.questions.length - 1;
  const next = () => (last ? onReview() : onGo(index + 1));
  // A sheet on its way out must not take keys meant for the next one.
  const present = useIsPresent();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!present || e.altKey || e.ctrlKey || e.metaKey) return;
      // A one-line answer field hands Enter on; any other field keeps it.
      const line =
        e.key === "Enter" &&
        !e.isComposing &&
        (e.target as Element).closest("[data-enter-next]");
      if (typing() && !line) return;
      if (e.key === "Enter") {
        const onButton = (e.target as Element).closest("button");
        if (onButton || e.repeat || !answered) return;
        e.preventDefault();
        next();
        return;
      }
      const i = keyed ? keyToOption(e.key, q.options.length) : null;
      if (i === null) return;
      e.preventDefault();
      const id = q.options[i].id;
      if (!multi) onAnswer(q.id, { items: [id] });
      else if (selected.includes(id)) {
        onAnswer(q.id, { items: selected.filter((x) => x !== id) });
      } else onAnswer(q.id, { items: [...selected, id] });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <QuestionSheet
      number={index + 1}
      total={test.questions.length}
      question={q}
      answer={answers[q.id]}
      onChange={(a) => onAnswer(q.id, a)}
    >
      <button type="button" className="s-btn s-btn-quiet" onClick={next}>
        <span>{m.test_skip()}</span>
      </button>
      <button
        type="button"
        className="s-btn"
        disabled={!answered}
        onClick={next}
      >
        <span>{last ? m.test_finish() : m.test_next()}</span>
      </button>
    </QuestionSheet>
  );
}

/**
 * Whether the keys belong elsewhere: a field that takes text has focus, or
 * the question grid popover is open. Answer tiles are radio and checkbox
 * inputs, so those do not count.
 */
function typing(): boolean {
  const el = document.activeElement;
  if (document.querySelector(".k-pop")) return true;
  if (el instanceof HTMLInputElement) {
    return !["radio", "checkbox", "button", "submit"].includes(el.type);
  }
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}
