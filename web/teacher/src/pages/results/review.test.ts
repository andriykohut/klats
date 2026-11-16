import type { Answer, Question } from "@klats/shared/generated/testfmt.ts";
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

test("each part of an answer shows what was given, what is right and the verdict", () => {
  const oneGap = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "gap", attrs: { id: "g1" } }] },
    ],
  };
  const cases: [
    string,
    Question,
    Answer,
    Record<string, boolean>,
    ReturnType<typeof flat>[],
  ][] = [
    [
      "a true/false statement",
      question({
        options: [
          { id: "s1", content: textDoc("s1"), correct: true },
          { id: "s2", content: textDoc("s2"), correct: false },
        ],
      }),
      { pairs: { s1: "true", s2: "true" } },
      { s1: true, s2: false },
      [
        ["s1", "Правда", "Правда", true],
        ["s2", "Правда", "Неправда", false],
      ],
    ],
    [
      "a typed gap",
      question({
        type: "gaps",
        body: oneGap,
        gaps: [{ id: "g1", accepted: ["1991"] }],
      }),
      { pairs: { g1: "1990" } },
      { g1: false },
      [["Пропуск 1", "1990", "1991", false]],
    ],
    [
      "a list gap",
      question({
        type: "gaps",
        body: oneGap,
        gaps: [
          {
            id: "g1",
            choices: [
              { id: "c1", text: "кіт", correct: true },
              { id: "c2", text: "пес", correct: false },
            ],
          },
        ],
      }),
      { pairs: { g1: "c2" } },
      { g1: false },
      [["Пропуск 1", "пес", "кіт", false]],
    ],
    [
      "a grid row",
      question({
        type: "grid",
        options: [
          { id: "r1", content: textDoc("рядок"), correct: false, target: "c2" },
        ],
        targets: [
          { id: "c1", content: textDoc("A"), x: 0, y: 0 },
          { id: "c2", content: textDoc("B"), x: 0, y: 0 },
        ],
      }),
      { pairs: { r1: "c1" } },
      { r1: false },
      [["рядок", "A", "B", false]],
    ],
    [
      "a labelled point",
      question({
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
      }),
      { pairs: { l3: "p1" } },
      { l3: false },
      [
        ["Точка 1", "Місяць", "Сонце", false],
        ["Точка 2", null, "Хмара", null],
      ],
    ],
    [
      "a word bank gap",
      question({
        type: "bank",
        body: oneGap,
        options: [
          { id: "w1", content: textDoc("кіт"), correct: false, target: "g1" },
          { id: "w2", content: textDoc("пес"), correct: false, target: "" },
        ],
      }),
      { pairs: { g1: "w2" } },
      { g1: false },
      [["Пропуск 1", "пес", "кіт", false]],
    ],
    [
      "a short answer",
      question({ type: "short", accepted: ["Київ", "м. Київ"] }),
      { text: "Львів" },
      { "": false },
      [["Відповідь", "Львів", "Київ / м. Київ", false]],
    ],
    [
      "a number answer",
      question({
        type: "number",
        number: {
          mode: "tolerance",
          value: 3.14,
          tolerance: 0.01,
          min: 0,
          max: 0,
        },
      }),
      { text: "3,15" },
      { "": true },
      [["Відповідь", "3,15", "3,14 ± 0,01", true]],
    ],
  ];
  for (const [name, q, a, verdicts, rows] of cases) {
    expect(reviewRows(q, a, verdicts).map(flat), name).toEqual(rows);
  }
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
