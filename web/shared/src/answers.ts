import type { Answer } from "./generated/testfmt";

/**
 * Whether `a` holds anything: items, pairs, non-blank text or a point. Mirrors
 * `Answer.IsEmpty` in Go.
 */
export function hasAnswer(a: Answer | undefined): boolean {
  return (
    !!a &&
    ((a.items?.length ?? 0) > 0 ||
      Object.keys(a.pairs ?? {}).length > 0 ||
      (a.text ?? "").trim() !== "" ||
      !!a.point)
  );
}

/**
 * Whether a student has finished answering `question`. A true/false or grid
 * question counts only when every statement or row has a value, so a partly
 * filled one still shows as open in the progress bar and the review; the
 * server grades the rows given. Any other type counts as soon as
 * {@link hasAnswer} does.
 */
export function isAnswered(
  question: { type: string; options: { id: string }[] },
  a: Answer | undefined,
): boolean {
  if (question.type === "truefalse" || question.type === "grid") {
    return question.options.every((o) => !!a?.pairs?.[o.id]);
  }
  return hasAnswer(a);
}
