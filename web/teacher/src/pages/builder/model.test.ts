import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { expect, test } from "vitest";
import {
  fromPasted,
  oneParagraph,
  plainText,
  textDoc,
  toStored,
} from "./model";

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

test("toStored keeps a code block's language, and drops an empty or unknown one", () => {
  const code = (language: string | null) => ({
    type: "codeBlock",
    attrs: { language },
    content: [{ type: "text", text: "x" }],
  });
  expect(toStored(code("python"))).toEqual({
    type: "codeBlock",
    attrs: { language: "python" },
    content: [{ type: "text", text: "x" }],
  });
  for (const none of [null, "", "ruby"]) {
    expect(toStored(code(none))).toEqual({
      type: "codeBlock",
      content: [{ type: "text", text: "x" }],
    });
  }
});

test("toStored keeps marks on text only", () => {
  const bold = [{ type: "bold" }];
  expect(
    toStored({
      type: "paragraph",
      content: [
        { type: "text", text: "x=", marks: bold },
        { type: "math", attrs: { latex: "\\pi" }, marks: bold },
        { type: "hardBreak", marks: bold },
      ],
    }),
  ).toEqual({
    type: "paragraph",
    content: [
      { type: "text", text: "x=", marks: bold },
      { type: "math", attrs: { latex: "\\pi" } },
      { type: "hardBreak" },
    ],
  });
});

test("toStored keeps table spans and drops widths", () => {
  const cell = (type: string, attrs: Record<string, unknown>) => ({
    type,
    attrs,
    content: [{ type: "paragraph", attrs: { textAlign: "left" } }],
  });
  const editor = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              cell("tableHeader", { colspan: 2, rowspan: 1, colwidth: [120] }),
              cell("tableCell", { colspan: 1, rowspan: 1, colwidth: null }),
            ],
          },
        ],
      },
      { type: "codeBlock", attrs: { language: null } },
    ],
  };
  expect(toStored(editor)).toEqual({
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 2 },
                content: [{ type: "paragraph" }],
              },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
      { type: "codeBlock" },
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

/** The inline schema of an option, as TipTap builds it: paragraphs of inline nodes. */
const inline = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
  },
  marks: { bold: {} },
});
const para = (...text: string[]) =>
  inline.node(
    "paragraph",
    null,
    text.map((t) => inline.text(t)),
  );

test("oneParagraph joins pasted paragraphs with hard breaks, skipping empty ones", () => {
  const bold = inline.node("paragraph", null, [
    inline.text("два", [inline.mark("bold")]),
  ]);
  const pasted = new Slice(Fragment.from([para("один"), para(), bold]), 0, 0);
  const out = oneParagraph(pasted, inline);
  expect([out.openStart, out.openEnd, out.content.childCount]).toEqual([
    1, 1, 1,
  ]);
  expect(out.content.firstChild?.toJSON()).toEqual({
    type: "paragraph",
    content: [
      { type: "text", text: "один" },
      { type: "hardBreak" },
      { type: "text", text: "два", marks: [{ type: "bold" }] },
    ],
  });
});

test("oneParagraph keeps a one-paragraph paste as it is, open to merge", () => {
  const out = oneParagraph(
    new Slice(Fragment.from(para("слово")), 1, 1),
    inline,
  );
  expect([out.openStart, out.openEnd]).toEqual([1, 1]);
  expect(out.content.toJSON()).toEqual([
    { type: "paragraph", content: [{ type: "text", text: "слово" }] },
  ]);
});
