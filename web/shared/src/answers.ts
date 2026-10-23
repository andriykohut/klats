import type { Answer } from "./generated/testfmt";

/**
 * Whether a student has answered: the answer holds items, pairs, non-blank
 * text or a point. Mirrors `Answer.IsEmpty` in Go.
 */
export function isAnswered(a: Answer | undefined): boolean {
  return (
    !!a &&
    ((a.items?.length ?? 0) > 0 ||
      Object.keys(a.pairs ?? {}).length > 0 ||
      (a.text ?? "").trim() !== "" ||
      !!a.point)
  );
}
