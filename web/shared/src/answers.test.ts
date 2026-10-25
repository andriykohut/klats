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

test("true/false, grid, match and groups are answered only when every option has a value", () => {
  for (const type of ["truefalse", "grid", "match", "groups"]) {
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

test("bank is answered only when every gap of the body has a word", () => {
  const gap = (id: string) => ({ type: "gap", attrs: { id } });
  const q = {
    type: "bank",
    options,
    body: {
      type: "doc",
      content: [{ type: "paragraph", content: [gap("g1"), gap("g2")] }],
    },
  };
  expect(isAnswered(q, undefined)).toBe(false);
  expect(isAnswered(q, { pairs: { g1: "a" } })).toBe(false);
  expect(isAnswered(q, { pairs: { g1: "a", g2: "b" } })).toBe(true);
});

test("order is answered once it has items", () => {
  const q = { type: "order", options };
  expect(isAnswered(q, undefined)).toBe(false);
  expect(isAnswered(q, { items: ["b", "a", "c"] })).toBe(true);
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
