import type { Question } from "@klats/shared/generated/testfmt.ts";
import { expect, test } from "vitest";
import { toStudent } from "./preview";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const base: Question = {
  id: "q",
  type: "single",
  text: doc("Питання"),
  points: 3,
  shuffleOptions: true,
  partial: true,
  options: [],
  accepted: ["відповідь"],
  rubric: "Критерії",
};

test("toStudent strips the key and keeps the teacher's order", () => {
  const single = toStudent({
    ...base,
    options: [
      { id: "b", content: doc("Б"), correct: false },
      { id: "a", content: doc("А"), correct: true },
    ],
  });
  expect(single.options).toEqual([
    { id: "b", content: doc("Б") },
    { id: "a", content: doc("А") },
  ]);
  expect(JSON.stringify(single)).not.toMatch(
    /correct|target|accepted|rubric|points|partial|shuffle/,
  );

  const grid = toStudent({
    ...base,
    type: "grid",
    options: [{ id: "r1", content: doc("Кіт"), correct: false, target: "c1" }],
    targets: [{ id: "c1", content: doc("Ссавці"), x: 0, y: 0 }],
  });
  expect(grid.options).toEqual([{ id: "r1", content: doc("Кіт") }]);
  expect(grid.targets?.map((t) => t.id)).toEqual(["c1"]);
  expect(JSON.stringify(grid)).not.toMatch(/"target"|correct/);
});

test("toStudent sends a highlight body as words with no target mark, and leaves out an open question's rubric", () => {
  const marked = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "яскраво ", marks: [{ type: "target" }] },
          { type: "text", text: "світить" },
        ],
      },
    ],
  };
  const highlight = toStudent({ ...base, type: "highlight", body: marked });
  expect(JSON.stringify(highlight)).not.toMatch(/target/);
  expect(
    (
      highlight.body as { content: { content: { type: string }[] }[] }
    ).content[0].content.map((n) => n.type),
  ).toEqual(["word", "text", "word"]);
  const open = toStudent({ ...base, type: "open" });
  expect(JSON.stringify(open)).not.toMatch(/rubric|Критерії/);
});

test("toStudent keeps a gaps question's body and the texts of a list gap's choices, not its key", () => {
  const body = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "gap", attrs: { id: "g1" } },
          { type: "gap", attrs: { id: "g2" } },
        ],
      },
    ],
  };
  const gaps = toStudent({
    ...base,
    type: "gaps",
    body,
    gaps: [
      { id: "g1", accepted: ["Київ"] },
      {
        id: "g2",
        choices: [
          { id: "c1", text: "Львів", correct: false },
          { id: "c2", text: "Харків", correct: true },
        ],
      },
    ],
  });
  expect(gaps.body).toEqual(body);
  expect(gaps.gaps?.[1]).toEqual({
    id: "g2",
    choices: [
      { id: "c1", text: "Львів" },
      { id: "c2", text: "Харків" },
    ],
  });
  expect(JSON.stringify(gaps)).not.toMatch(/correct|accepted|Київ/);
});
