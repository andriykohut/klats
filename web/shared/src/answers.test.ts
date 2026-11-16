import { expect, test } from "vitest";
import { isAnswered, withPair } from "./answers";
import type { Answer } from "./generated/testfmt";

const options = ["a", "b", "c"].map((id) => ({ id }));
const single = { type: "single", options };

type Case = [Parameters<typeof isAnswered>[0], Answer | undefined, boolean];

test("a question counts as answered by the rule of its type", () => {
  const gap = (id: string) => ({ type: "gap", attrs: { id } });
  const gaps = {
    type: "gaps",
    options: [],
    gaps: [{ id: "a" }, { id: "b" }, { id: "c" }],
  };
  const bank = {
    type: "bank",
    options,
    body: {
      type: "doc",
      content: [{ type: "paragraph", content: [gap("g1"), gap("g2")] }],
    },
  };
  const label = {
    type: "label",
    options: ["l1", "l2", "decoy"].map((id) => ({ id })),
    targets: [{ id: "p1" }, { id: "p2" }],
  };
  const order = { type: "order", options };
  const hotspot = { type: "hotspot", options: [] };
  const highlight = { type: "highlight", options: [] };
  const open = { type: "open", options: [] };
  const cases: Case[] = [
    // A type with no rule of its own counts any part of an answer.
    [single, undefined, false],
    [single, {}, false],
    [single, { text: " " }, false],
    [single, { items: [] }, false],
    [single, { pairs: {} }, false],
    [single, { items: ["a"] }, true],
    [single, { text: "x" }, true],
    [single, { point: { x: 0, y: 0 } }, true],
    [single, { pairs: { a: "x" } }, true],
    [order, undefined, false],
    [order, { items: ["b", "a", "c"] }, true],
    ...["short", "number"].flatMap((type): Case[] => [
      [{ type, options: [] }, { text: " " }, false],
      [{ type, options: [] }, { text: "9,8" }, true],
    ]),
    [hotspot, {}, false],
    [hotspot, { point: { x: 0, y: 0 } }, true],
    [highlight, { items: [] }, false],
    [highlight, { items: ["0"] }, true],
    [open, { text: " \n " }, false],
    [open, { text: "Так" }, true],
    // True/false, grid, match and groups need a value for every option.
    ...["truefalse", "grid", "match", "groups"].flatMap((type): Case[] => [
      [{ type, options }, undefined, false],
      [{ type, options }, { pairs: { a: "x", b: "y" } }, false],
      [{ type, options }, { pairs: { a: "x", b: "y", c: "z" } }, true],
    ]),
    // Gaps need non-blank text in every gap.
    [gaps, undefined, false],
    [gaps, { pairs: { a: "x", b: "y" } }, false],
    [gaps, { pairs: { a: "x", b: "y", c: "z" } }, true],
    [gaps, { pairs: { a: "x", b: " ", c: "z" } }, false],
    // A word bank needs a word in every gap of its body.
    [bank, undefined, false],
    [bank, { pairs: { g1: "a" } }, false],
    [bank, { pairs: { g1: "a", g2: "b" } }, true],
    // Labels need a label on every point; decoys need no place.
    [label, undefined, false],
    [label, { pairs: { l1: "p1" } }, false],
    [label, { pairs: { l1: "p1", decoy: "p1" } }, false],
    [label, { pairs: { l1: "p1", l2: "p2" } }, true],
    [label, { pairs: { l1: "p1", decoy: "p2" } }, true],
  ];
  for (const [q, a, want] of cases) {
    expect(isAnswered(q, a), `${q.type} ${JSON.stringify(a)}`).toBe(want);
  }
});

test("withPair sets a gap's value and drops its key when it is empty", () => {
  expect(withPair({ a: "x" }, "b", "y")).toEqual({ a: "x", b: "y" });
  expect(withPair({ a: "x", b: "y" }, "b", "")).toEqual({ a: "x" });
  expect(withPair({ a: "x" }, "a", " ")).toEqual({ a: " " });
});
