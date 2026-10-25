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

test("toStudent leaves out a highlight body and an open question's rubric", () => {
  const marked = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "слово", marks: [{ type: "target" }] }],
      },
    ],
  };
  const highlight = toStudent({ ...base, type: "highlight", body: marked });
  expect(JSON.stringify(highlight)).not.toMatch(/target|marks/);
  const open = toStudent({ ...base, type: "open" });
  expect(JSON.stringify(open)).not.toMatch(/rubric|Критерії/);
});
