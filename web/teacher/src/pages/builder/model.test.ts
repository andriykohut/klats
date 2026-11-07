import type { Question } from "@klats/shared/generated/testfmt.ts";
import { QUESTION_TYPES } from "@klats/shared/questionTypes.ts";
import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { expect, test } from "vitest";
import {
  addTag,
  clearTakenTargets,
  convertQuestion,
  fromPasted,
  gapInMode,
  gapsInBody,
  listed,
  newOption,
  newQuestion,
  oneParagraph,
  plainText,
  syncGaps,
  tagCounts,
  tagLabel,
  textDoc,
  toStored,
  trimmedRange,
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

test("convertQuestion starts a field the source type does not use at the new type's default", () => {
  // A saved single-choice question has partial false: the server clears what a type does not use.
  const single = { ...newQuestion("single"), partial: false };
  expect(convertQuestion(single, "multi").partial).toBe(true);

  const order = {
    ...newQuestion("order"),
    shuffleOptions: false,
    partial: false,
  };
  const back = convertQuestion(order, "single");
  expect(back.shuffleOptions).toBe(true);
  // Both types use partial, so the teacher's choice stays.
  expect(convertQuestion(order, "match").partial).toBe(false);
  const multi = { ...newQuestion("multi"), partial: false };
  expect(convertQuestion(multi, "truefalse").partial).toBe(false);
});

test("convertQuestion gives a match each right-hand target once", () => {
  const grid = {
    ...newQuestion("grid"),
    options: [newOption("а"), newOption("б")],
  };
  grid.options[0].target = grid.targets?.[0].id;
  grid.options[1].target = grid.targets?.[0].id;
  const match = convertQuestion(grid, "match");
  const [first, second] = match.options.map((o) => o.target);
  expect(first).toBe(grid.targets?.[0].id);
  expect(second && second !== first).toBeTruthy();
  // The grid's other column stays as an extra choice, and the second option owns a new target.
  expect(match.targets?.map((t) => t.id)).toEqual([
    ...(grid.targets?.map((t) => t.id) ?? []),
    second,
  ]);
});

test("convertQuestion gives each option of a new match a target of its own", () => {
  const order = {
    ...newQuestion("order"),
    options: [newOption("а"), newOption("б"), newOption("в")],
  };
  const match = convertQuestion(order, "match");
  const named = match.options.map((o) => o.target);
  expect(new Set(named).size).toBe(3);
  expect(match.targets?.map((t) => t.id)).toEqual(named);
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

test("convertQuestion to the question's own type changes nothing", () => {
  const short = { ...newQuestion("short"), accepted: ["кіт"] };
  expect(convertQuestion(short, "short")).toBe(short);
  const label = {
    ...newQuestion("label"),
    targets: [{ id: "p", content: textDoc(""), x: 0.5, y: 0.5 }],
  };
  expect(convertQuestion(label, "label").targets).toEqual(label.targets);
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

const gapBody = (...ids: string[]) => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: ids.flatMap((id) => [
        { type: "text", text: "a " },
        { type: "gap", attrs: { id } },
      ]),
    },
    {
      type: "paragraph",
      content: [{ type: "math", attrs: { latex: "x" } }],
    },
  ],
});

test("gapsInBody lists the gap ids in document order", () => {
  expect(gapsInBody(gapBody("g2", "g1"))).toEqual(["g2", "g1"]);
  expect(gapsInBody(textDoc("Кіт"))).toEqual([]);
  const nested = {
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "gap", attrs: { id: "x" } }] },
      { type: "paragraph", content: [{ type: "gap", attrs: { id: "y" } }] },
    ],
  };
  expect(gapsInBody(nested)).toEqual(["x", "y"]);
});

test("toStored keeps the id of a gap", () => {
  expect(toStored({ type: "gap", attrs: { id: "g1", extra: 1 } })).toEqual({
    type: "gap",
    attrs: { id: "g1" },
  });
});

test("syncGaps keeps the entries of the gaps in the body, in body order, and stashes the rest", () => {
  const stash = new Map();
  const g1 = { id: "g1", accepted: ["Київ"] };
  const g2 = {
    id: "g2",
    choices: [{ id: "c", text: "три", correct: true }],
  };

  // g2 is first in the body, g3 is new, g1 is gone.
  const gaps = syncGaps([g1, g2], gapBody("g2", "g3"), stash);
  expect(gaps).toEqual([g2, { id: "g3" }]);
  expect(stash.get("g1")).toBe(g1);

  // An undo brings g1 back with its answers.
  expect(syncGaps(gaps, gapBody("g1", "g2", "g3"), stash)).toEqual([
    g1,
    g2,
    { id: "g3" },
  ]);
  expect(syncGaps(undefined, textDoc(""), stash)).toEqual([]);
});

test("gapInMode saves only the fields of the mode and gives the other mode's data back", () => {
  const blank = () => [{ id: "b", text: "", correct: false }];
  const typed = { id: "g", accepted: ["Київ"] };

  const list = gapInMode(typed, true, undefined, blank);
  expect(list).toEqual({ id: "g", choices: blank() });
  expect(list).not.toHaveProperty("accepted");

  // Back to typed: the accepted texts return and no choices are kept.
  expect(gapInMode(list, false, typed, blank)).toEqual(typed);
  const edited = {
    id: "g",
    choices: [{ id: "c", text: "три", correct: true }],
  };
  expect(gapInMode(edited, false, undefined, blank)).toEqual({ id: "g" });

  // A list whose choices were all removed stays a list, with no stale texts.
  const emptied = gapInMode({ id: "g", choices: [] }, true, typed, blank);
  expect(emptied).toEqual({ id: "g", choices: [] });
  // Switching to list again gives back the choices the gap had.
  expect(gapInMode(typed, true, edited, blank).choices).toEqual(edited.choices);
});

test("trimmedRange leaves the whitespace at the ends of a selection out", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
      gap: { group: "inline", inline: true, atom: true },
    },
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("Київ є столицею")]),
    schema.node("paragraph", null, [schema.text("  "), schema.node("gap")]),
  ]);
  // Positions: the first paragraph's text starts at 1.
  expect(trimmedRange(doc, 1, 6)).toEqual({ from: 1, to: 5 });
  expect(trimmedRange(doc, 5, 9)).toEqual({ from: 6, to: 9 });
  expect(trimmedRange(doc, 1, 5)).toEqual({ from: 1, to: 5 });
  // Only whitespace, and a selection across paragraphs, stay as they are.
  expect(trimmedRange(doc, 5, 6)).toEqual({ from: 5, to: 6 });
  expect(trimmedRange(doc, 3, 20)).toEqual({ from: 3, to: 20 });
  // An inline atom is not whitespace.
  expect(trimmedRange(doc, 18, 21)).toEqual({ from: 20, to: 21 });
});

test("convertQuestion drops an option's target that names none of the question's targets", () => {
  const groups = {
    ...newQuestion("groups"),
    options: [newOption("а"), newOption("б")],
  };
  groups.options[0].target = groups.targets?.[0].id;
  groups.options[1].target = "removed-group";
  const match = convertQuestion(groups, "match");
  const named = match.options.map((o) => o.target);
  expect(named[0]).toBe(groups.targets?.[0].id);
  expect(named[1] && named[1] !== "removed-group").toBeTruthy();
  expect(match.targets?.some((t) => t.id === named[1])).toBe(true);
});

test("clearTakenTargets leaves a restored word a decoy when its gap has a word", () => {
  const word = (id: string, target: string) => ({
    ...newOption(id),
    id,
    target,
  });
  const taken = [word("a", "g1")];
  const restored = [word("b", "g1"), word("c", "g2"), word("d", "g2")];
  const out = clearTakenTargets(restored, taken, ["g1", "g2"]);
  expect(out.map((o) => o.target)).toEqual(["", "g2", ""]);
  // A target of a gap that is gone is not a conflict.
  expect(
    clearTakenTargets([word("e", "gone")], [word("f", "gone")], ["g1"]),
  ).toEqual([word("e", "gone")]);
});

/** A single-choice question with `fields` set. */
const q = (fields: Partial<Question>): Question => ({
  ...newQuestion("single"),
  ...fields,
});

test("tagCounts in order of first appearance", () => {
  expect(
    tagCounts([q({ tags: ["B"] }), q({ tags: ["A", "B"] }), q({})]),
  ).toEqual([
    ["B", 2],
    ["A", 1],
  ]);
});

test("addTag trims and ignores blanks and repeats", () => {
  expect(addTag(["Мережі"], " Урок 9 ")).toEqual(["Мережі", "Урок 9"]);
  expect(addTag(["Мережі"], "Мережі ")).toEqual(["Мережі"]);
  expect(addTag(undefined, "  ")).toEqual([]);
});

test("tagLabel fits whole tags, then counts the rest", () => {
  expect(tagLabel(["Мережі", "Урок 9"])).toEqual({
    shown: "Мережі, Урок 9",
    more: 0,
  });
  expect(
    tagLabel(["Урок_10 Безпечне використання Інтернету", "Мережі"]),
  ).toEqual({ shown: "Урок_10 Безпечне використання Інтернету", more: 1 });
});

test("listed keeps real numbers and the selected question", () => {
  const qs = [
    q({ id: "a", tags: ["X"] }),
    q({ id: "b" }),
    q({ id: "c", tags: ["X"] }),
  ];
  expect(listed(qs, "X", "a").map((r) => r.number)).toEqual([1, 3]);
  expect(listed(qs, "X", "b").map((r) => r.number)).toEqual([1, 2, 3]);
  expect(listed(qs, "", "a").map((r) => r.number)).toEqual([1, 2]);
});

test("convertQuestion keeps tags", () => {
  expect(
    convertQuestion({ ...newQuestion("single"), tags: ["A"] }, "multi").tags,
  ).toEqual(["A"]);
});
