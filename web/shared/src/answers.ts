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
 * question counts only when every statement or row has a value, and a gaps
 * question only when every gap has non-blank text or a choice, so a partly
 * filled one still shows as open in the progress bar and the review; the
 * server grades what is given. Any other type counts as soon as
 * {@link hasAnswer} does.
 */
export function isAnswered(
  question: {
    type: string;
    options: { id: string }[];
    gaps?: { id: string }[];
  },
  a: Answer | undefined,
): boolean {
  if (question.type === "truefalse" || question.type === "grid") {
    return question.options.every((o) => !!a?.pairs?.[o.id]);
  }
  if (question.type === "gaps") {
    return (question.gaps ?? []).every(
      (g) => (a?.pairs?.[g.id] ?? "").trim() !== "",
    );
  }
  return hasAnswer(a);
}

/**
 * Returns `pairs` with `id` set to `value`, or without `id` when `value` is
 * empty: the server rejects a whole change that carries an empty value.
 */
export function withPair(
  pairs: Record<string, string>,
  id: string,
  value: string,
): Record<string, string> {
  const { [id]: _, ...rest } = pairs;
  return value === "" ? rest : { ...rest, [id]: value };
}
