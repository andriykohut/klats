import { expect, test } from "vitest";
import { fromPasted, plainText, textDoc, toStored } from "./model";

test("toStored keeps only the keys the server allows", () => {
  const editor = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3, type: null },
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { textAlign: "left" },
                content: [
                  {
                    type: "text",
                    text: "H",
                    marks: [{ type: "bold", attrs: {} }],
                  },
                  { type: "text", text: "2", marks: [{ type: "subscript" }] },
                ],
              },
            ],
          },
        ],
      },
      { type: "paragraph", content: [] },
    ],
  };
  expect(toStored(editor)).toEqual({
    type: "doc",
    content: [
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "H", marks: [{ type: "bold" }] },
                  { type: "text", text: "2", marks: [{ type: "subscript" }] },
                ],
              },
            ],
          },
        ],
      },
      { type: "paragraph" },
    ],
  });
});

test("textDoc wraps plain text in one paragraph", () => {
  expect(textDoc("8")).toEqual({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "8" }] }],
  });
  expect(textDoc("")).toEqual({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
});

test("plainText joins blocks and hard breaks with spaces", () => {
  const doc = {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "hardBreak" },
          { type: "text", text: "b" },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "c" }] },
            ],
          },
        ],
      },
    ],
  };
  expect(plainText(doc)).toBe("a b c");
  expect(plainText({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
});

test("fromPasted builds questions with fresh ids", () => {
  const [q] = fromPasted([
    {
      text: "Q",
      type: "multi",
      options: [
        { text: "a", correct: true },
        { text: "b", correct: true },
      ],
    },
  ]);
  expect(q.type).toBe("multi");
  expect(q.points).toBe(1);
  expect(q.shuffleOptions).toBe(true);
  expect(q.text).toEqual(textDoc("Q"));
  expect(q.options.map((o) => [o.content, o.correct])).toEqual([
    [textDoc("a"), true],
    [textDoc("b"), true],
  ]);
  const ids = [q.id, ...q.options.map((o) => o.id)];
  expect(new Set(ids).size).toBe(3);
  expect(ids.every((id) => /^[a-z0-9]{16}$/.test(id))).toBe(true);
});
