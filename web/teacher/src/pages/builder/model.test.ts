import { QUESTION_TYPES } from "@klats/shared/questionTypes.ts";
import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { expect, test } from "vitest";
import {
  convertQuestion,
  fromPasted,
  newOption,
  newQuestion,
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

/** The least options and targets each type needs, as internal/testfmt checks. */
const LEAST: Record<string, { options?: number; targets?: number }> = {
  single: { options: 2 },
  multi: { options: 2 },
  truefalse: { options: 1 },
  grid: { options: 1, targets: 2 },
  order: { options: 3 },
  match: { options: 2 },
  groups: { options: 2, targets: 2 },
};

test("newQuestion shapes", () => {
  for (const { type } of QUESTION_TYPES) {
    const q = newQuestion(type);
    expect(q.type).toBe(type);
    expect(q.points).toBe(1);
    expect(q.partial).toBe(true);
    expect(q.shuffleOptions).toBe(true);
    expect(q.options.length).toBeGreaterThanOrEqual(LEAST[type]?.options ?? 0);
    expect((q.targets ?? []).length).toBeGreaterThanOrEqual(
      LEAST[type]?.targets ?? 0,
    );
  }
  expect(newQuestion("truefalse").options).toHaveLength(2);
  const grid = newQuestion("grid");
  expect([grid.options.length, grid.targets?.length]).toEqual([2, 2]);
  expect(newQuestion("order").options).toHaveLength(3);
  const match = newQuestion("match");
  expect(match.options.map((o) => o.target)).toEqual(
    match.targets?.map((t) => t.id),
  );
  const groups = newQuestion("groups");
  expect([groups.options.length, groups.targets?.length]).toEqual([2, 2]);
  expect(groups.options.map((o) => o.target)).toEqual(
    groups.targets?.map((t) => t.id),
  );
  for (const type of ["gaps", "bank", "highlight"]) {
    expect(newQuestion(type).body).toEqual(textDoc(""));
  }
  for (const type of ["short", "number", "hotspot", "label", "open"]) {
    expect(newQuestion(type).options).toEqual([]);
  }
});

const abvg = ["А", "Б", "В", "Г"];

/** A single-choice question worth 3 points with four options, the second correct. */
function filled() {
  return {
    ...newQuestion("single"),
    text: textDoc("Т"),
    points: 3,
    shuffleOptions: false,
    options: abvg.map((t, i) => newOption(t, i === 1)),
  };
}

test("convertQuestion keeps what it can", () => {
  const single = filled();
  const order = convertQuestion(single, "order");
  expect(order.type).toBe("order");
  expect(order.id).toBe(single.id);
  expect(order.text).toEqual(textDoc("Т"));
  expect(order.points).toBe(3);
  expect(order.shuffleOptions).toBe(false);
  expect(order.options.map((o) => o.content)).toEqual(abvg.map(textDoc));
  expect(order.options.map((o) => o.id)).toEqual(
    single.options.map((o) => o.id),
  );
  expect(order.options.some((o) => o.correct)).toBe(false);

  const multi = convertQuestion(single, "multi");
  expect(multi.options.map((o) => o.correct)).toEqual([
    false,
    true,
    false,
    false,
  ]);
  expect(
    convertQuestion(multi, "truefalse").options.map((o) => o.correct),
  ).toEqual([false, true, false, false]);

  const groups = {
    ...newQuestion("groups"),
    text: textDoc("Т"),
    options: [newOption("а"), newOption("б")],
    targets: [
      { id: "g1", content: textDoc("1"), x: 0, y: 0 },
      { id: "g2", content: textDoc("2"), x: 0, y: 0 },
    ],
  };
  groups.options[0].target = "g2";
  groups.options[1].target = "g1";
  const grid = convertQuestion(groups, "grid");
  expect(grid.targets?.map((t) => t.id)).toEqual(["g1", "g2"]);
  expect(grid.options.map((o) => o.target)).toEqual(["g2", "g1"]);
  const single2 = convertQuestion(grid, "single");
  expect(single2.targets ?? []).toEqual([]);
  expect(single2.options.map((o) => o.target)).toEqual([undefined, undefined]);
});

test("convertQuestion gives a match each right-hand target once", () => {
  const grid = {
    ...newQuestion("grid"),
    options: [newOption("а"), newOption("б")],
  };
  grid.options[0].target = grid.targets?.[0].id;
  grid.options[1].target = grid.targets?.[0].id;
  const match = convertQuestion(grid, "match");
  expect(match.options.map((o) => o.target)).toEqual([
    grid.targets?.[0].id,
    undefined,
  ]);
});

test("convertQuestion moves a body between gaps, bank and highlight", () => {
  const marked = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Кіт",
            marks: [{ type: "bold" }, { type: "target" }],
          },
          { type: "text", text: " спить" },
        ],
      },
    ],
  };
  const highlight = { ...newQuestion("highlight"), body: marked };
  const gaps = convertQuestion(highlight, "gaps");
  expect(gaps.body).toEqual({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Кіт", marks: [{ type: "bold" }] },
          { type: "text", text: " спить" },
        ],
      },
    ],
  });
  expect(convertQuestion(highlight, "bank").body).toEqual(gaps.body);

  const gapped = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Кіт " },
          { type: "gap", attrs: { id: "a" } },
          { type: "math", attrs: { latex: "x" } },
          { type: "text", text: " спить" },
        ],
      },
    ],
  };
  const bank = { ...newQuestion("bank"), body: gapped };
  expect(convertQuestion(bank, "gaps").body).toEqual(gapped);
  expect(convertQuestion(bank, "highlight").body).toEqual({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Кіт " },
          { type: "text", text: " спить" },
        ],
      },
    ],
  });
  expect(convertQuestion(bank, "single").body).toBeUndefined();
});

test("convertQuestion moves the image between hotspot and label only", () => {
  const image = { src: `${"a".repeat(64)}.png`, w: 10, h: 20 };
  const hotspot = { ...newQuestion("hotspot"), image };
  expect(convertQuestion(hotspot, "label").image).toEqual(image);
  expect(convertQuestion(hotspot, "open").image).toBeUndefined();
});

test("convertQuestion leaves a label's points behind", () => {
  const label = {
    ...newQuestion("label"),
    targets: [{ id: "p", content: textDoc(""), x: 0.5, y: 0.5 }],
  };
  const grid = convertQuestion(label, "grid");
  expect(grid.targets).toHaveLength(2);
  expect(grid.targets?.some((t) => t.id === "p")).toBe(false);
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
