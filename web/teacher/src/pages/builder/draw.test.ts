import type { Question } from "@klats/shared/generated/testfmt.ts";
import { expect, test } from "vitest";
import { drawTotal, sourceSize } from "./draw";
import { newQuestion } from "./model";

const tagged = (...tags: string[]): Question => ({
  ...newQuestion("single"),
  tags,
});

/** A: 2 questions, B: 3, one untagged: 6 questions. */
const qs = [
  tagged("A"),
  tagged("A"),
  tagged("B"),
  tagged("B"),
  tagged("B"),
  newQuestion("single"),
];

test("sourceSize counts the tag, or every question for ''", () => {
  expect(sourceSize(qs, "A")).toBe(2);
  expect(sourceSize(qs, "")).toBe(6);
  expect(sourceSize(qs, "Z")).toBe(0);
});

test("drawTotal caps each line at its source and the sum at the test", () => {
  expect(
    drawTotal(qs, [
      { tag: "A", count: 3 },
      { tag: "B", count: 1 },
    ]),
  ).toBe(3);
  expect(drawTotal(qs, [{ tag: "Z", count: 2 }])).toBe(0);
  expect(drawTotal(qs, [{ tag: "", count: 9 }])).toBe(6);
});
