import type { DrawLine, Question } from "@klats/shared/generated/testfmt.ts";

/** Returns how many questions a draw line picks from: every question for an empty `tag`, otherwise those tagged `tag`. */
export function sourceSize(questions: Question[], tag: string): number {
  return tag === ""
    ? questions.length
    : questions.filter((q) => q.tags?.includes(tag)).length;
}

/**
 * Returns how many questions `lines` give each student: each line's count up
 * to the size of its source, summed, and at most the whole test. Lines whose
 * sources share questions can give fewer, since no question is picked twice.
 */
export function drawTotal(questions: Question[], lines: DrawLine[]): number {
  const sum = lines.reduce(
    (n, l) => n + Math.min(l.count, sourceSize(questions, l.tag)),
    0,
  );
  return Math.min(sum, questions.length);
}
