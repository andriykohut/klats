import type { StudentTest } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { QuestionSheet } from "@klats/shared/student-ui/QuestionSheet.tsx";
import { useIsPresent } from "motion/react";
import { useEffect } from "react";
import { keyToOption } from "../input/keyboard";

/**
 * One question of the test on its sheet, with Skip and Next (Finish on the
 * last question, which leads to the review). Next waits for an answer; Skip
 * never does. Keys pick answers (see {@link keyToOption}) and Enter means
 * Next, except while a text field or the question grid has focus.
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
  answers: Record<string, string[]>;
  onAnswer: (questionId: string, optionIds: string[]) => void;
  onGo: (index: number) => void;
  onReview: () => void;
}) {
  const q = test.questions[index];
  const multi = q.type === "multi";
  const selected = answers[q.id] ?? [];
  const last = index === test.questions.length - 1;
  const next = () => (last ? onReview() : onGo(index + 1));
  // A sheet on its way out must not take keys meant for the next one.
  const present = useIsPresent();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!present || e.altKey || e.ctrlKey || e.metaKey || typing()) return;
      if (e.key === "Enter") {
        const onButton = (e.target as Element).closest("button");
        if (onButton || e.repeat || selected.length === 0) return;
        e.preventDefault();
        next();
        return;
      }
      const i = keyToOption(e.key, q.options.length);
      if (i === null) return;
      e.preventDefault();
      const id = q.options[i].id;
      if (!multi) onAnswer(q.id, [id]);
      else if (selected.includes(id)) {
        onAnswer(
          q.id,
          selected.filter((x) => x !== id),
        );
      } else onAnswer(q.id, [...selected, id]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <QuestionSheet
      number={index + 1}
      total={test.questions.length}
      text={q.text}
      options={q.options}
      multi={multi}
      selected={selected}
      onChange={(ids) => onAnswer(q.id, ids)}
    >
      <button type="button" className="s-btn s-btn-quiet" onClick={next}>
        <span>{m.test_skip()}</span>
      </button>
      <button
        type="button"
        className="s-btn"
        disabled={selected.length === 0}
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
