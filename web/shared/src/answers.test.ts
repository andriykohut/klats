import { expect, test } from "vitest";
import { hasAnswer, isAnswered } from "./answers";

const options = ["a", "b", "c"].map((id) => ({ id }));
const single = { type: "single", options };

test("isAnswered", () => {
  expect(
    [undefined, {}, { text: " " }, { items: [] }].map((a) =>
      isAnswered(single, a),
    ),
  ).toEqual([false, false, false, false]);
  expect(
    [{ items: ["a"] }, { text: "x" }, { point: { x: 0, y: 0 } }].map((a) =>
      isAnswered(single, a),
    ),
  ).toEqual([true, true, true]);
});

test("true/false and grid are answered only when every row has a value", () => {
  for (const type of ["truefalse", "grid"]) {
    const q = { type, options };
    expect(isAnswered(q, undefined)).toBe(false);
    expect(isAnswered(q, { pairs: { a: "x", b: "y" } })).toBe(false);
    expect(isAnswered(q, { pairs: { a: "x", b: "y", c: "z" } })).toBe(true);
  }
});

test("hasAnswer is true for any part of an answer", () => {
  expect(hasAnswer({ pairs: { a: "x" } })).toBe(true);
  expect(hasAnswer({ pairs: {} })).toBe(false);
});
