import { expect, test } from "vitest";
import { hasAnswer, isAnswered, withPair } from "./answers";

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

test("gaps are answered only when every gap has non-blank text", () => {
  const q = {
    type: "gaps",
    options: [],
    gaps: [{ id: "a" }, { id: "b" }, { id: "c" }],
  };
  expect(isAnswered(q, undefined)).toBe(false);
  expect(isAnswered(q, { pairs: { a: "x", b: "y" } })).toBe(false);
  expect(isAnswered(q, { pairs: { a: "x", b: "y", c: "z" } })).toBe(true);
  expect(isAnswered(q, { pairs: { a: "x", b: " ", c: "z" } })).toBe(false);
});

test("short and number are answered by any non-blank text", () => {
  for (const type of ["short", "number"]) {
    const q = { type, options: [] };
    expect(isAnswered(q, { text: " " })).toBe(false);
    expect(isAnswered(q, { text: "9,8" })).toBe(true);
  }
});

test("withPair sets a gap's value and drops its key when it is empty", () => {
  expect(withPair({ a: "x" }, "b", "y")).toEqual({ a: "x", b: "y" });
  expect(withPair({ a: "x", b: "y" }, "b", "")).toEqual({ a: "x" });
  expect(withPair({ a: "x" }, "a", " ")).toEqual({ a: " " });
});

test("hasAnswer is true for any part of an answer", () => {
  expect(hasAnswer({ pairs: { a: "x" } })).toBe(true);
  expect(hasAnswer({ pairs: {} })).toBe(false);
});
