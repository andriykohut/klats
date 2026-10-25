import type { Question } from "@klats/shared/generated/testfmt.ts";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import { expect, test } from "vitest";
import { plainText, textDoc } from "../builder/model";
import { type ReviewRow, reviewRows } from "./review";

const text = (v: RichDoc | string | null) =>
  v === null ? null : typeof v === "string" ? v : plainText(v);

/** A row with its documents flattened to text, to compare. */
const flat = (r: ReviewRow) => [
  text(r.prompt),
  text(r.given),
  text(r.expected),
  r.ok,
];

const question = (fields: Partial<Question>): Question => ({
  id: "q1",
  type: "truefalse",
  text: textDoc("Питання"),
  points: 2,
  shuffleOptions: false,
  partial: true,
  options: [],
  ...fields,
});

test("a true/false question reviews each statement against the verdicts", () => {
  const q = question({
    options: [
      { id: "s1", content: textDoc("s1"), correct: true },
      { id: "s2", content: textDoc("s2"), correct: false },
    ],
  });
  const rows = reviewRows(
    q,
    { pairs: { s1: "true", s2: "true" } },
    {
      s1: true,
      s2: false,
    },
  );
  expect(rows.map(flat)).toEqual([
    ["s1", "Правда", "Правда", true],
    ["s2", "Правда", "Неправда", false],
  ]);
});

test("a typed gap reviews the typed text against the accepted one", () => {
  const body = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "gap", attrs: { id: "g1" } }] },
    ],
  };
  const q = question({
    type: "gaps",
    body,
    gaps: [{ id: "g1", accepted: ["1991"] }],
  });
  const rows = reviewRows(q, { pairs: { g1: "1990" } }, { g1: false });
  expect(rows.map(flat)).toEqual([["Пропуск 1", "1990", "1991", false]]);
});

test("a list gap shows the chosen entry and the right one", () => {
  const body = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "gap", attrs: { id: "g1" } }] },
    ],
  };
  const q = question({
    type: "gaps",
    body,
    gaps: [
      {
        id: "g1",
        choices: [
          { id: "c1", text: "кіт", correct: true },
          { id: "c2", text: "пес", correct: false },
        ],
      },
    ],
  });
  const rows = reviewRows(q, { pairs: { g1: "c2" } }, { g1: false });
  expect(rows.map(flat)).toEqual([["Пропуск 1", "пес", "кіт", false]]);
});

test("a grid row shows the column picked and the column it belongs to", () => {
  const q = question({
    type: "grid",
    options: [
      { id: "r1", content: textDoc("рядок"), correct: false, target: "c2" },
    ],
    targets: [
      { id: "c1", content: textDoc("A"), x: 0, y: 0 },
      { id: "c2", content: textDoc("B"), x: 0, y: 0 },
    ],
  });
  expect(
    reviewRows(q, { pairs: { r1: "c1" } }, { r1: false }).map(flat),
  ).toEqual([["рядок", "A", "B", false]]);
});

test("a labelled point shows the label placed on it and the right one", () => {
  const q = question({
    type: "label",
    targets: [
      { id: "p1", content: textDoc(""), x: 0.2, y: 0.3 },
      { id: "p2", content: textDoc(""), x: 0.5, y: 0.6 },
    ],
    options: [
      { id: "l1", content: textDoc("Сонце"), correct: false, target: "p1" },
      { id: "l2", content: textDoc("Хмара"), correct: false, target: "p2" },
      { id: "l3", content: textDoc("Місяць"), correct: false },
    ],
  });
  const rows = reviewRows(q, { pairs: { l3: "p1" } }, { l3: false });
  expect(rows.map(flat)).toEqual([
    ["Точка 1", "Місяць", "Сонце", false],
    ["Точка 2", null, "Хмара", null],
  ]);
});

test("a word bank gap shows the word put in and the expected one", () => {
  const body = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "gap", attrs: { id: "g1" } }] },
    ],
  };
  const q = question({
    type: "bank",
    body,
    options: [
      { id: "w1", content: textDoc("кіт"), correct: false, target: "g1" },
      { id: "w2", content: textDoc("пес"), correct: false, target: "" },
    ],
  });
  expect(
    reviewRows(q, { pairs: { g1: "w2" } }, { g1: false }).map(flat),
  ).toEqual([["Пропуск 1", "пес", "кіт", false]]);
});

test("short and number answers review the one typed text", () => {
  const short = question({ type: "short", accepted: ["Київ", "м. Київ"] });
  expect(reviewRows(short, { text: "Львів" }, { "": false }).map(flat)).toEqual(
    [["Відповідь", "Львів", "Київ / м. Київ", false]],
  );
  const number = question({
    type: "number",
    number: { mode: "tolerance", value: 3.14, tolerance: 0.01, min: 0, max: 0 },
  });
  expect(reviewRows(number, { text: "3,15" }, { "": true }).map(flat)).toEqual([
    ["Відповідь", "3,15", "3,14 ± 0,01", true],
  ]);
});

test("a question without an answer has no given text and no verdict", () => {
  const q = question({
    options: [{ id: "s1", content: textDoc("s1"), correct: true }],
  });
  expect(reviewRows(q, undefined, undefined).map(flat)).toEqual([
    ["s1", null, "Правда", null],
  ]);
  const gaps = question({
    type: "gaps",
    gaps: [{ id: "g1", accepted: ["1991"] }],
    body: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "gap", attrs: { id: "g1" } }] },
      ],
    },
  });
  expect(reviewRows(gaps, undefined, undefined).map(flat)).toEqual([
    ["Пропуск 1", null, "1991", null],
  ]);
});

test("the types with a view of their own have no rows", () => {
  for (const type of [
    "single",
    "multi",
    "order",
    "hotspot",
    "highlight",
    "open",
  ]) {
    expect(reviewRows(question({ type }), { text: "x" }, undefined)).toEqual(
      [],
    );
  }
});
