import { CODE_LANGUAGES } from "@klats/shared/code/registry.ts";
import type {
  Option,
  Question,
  Target,
} from "@klats/shared/generated/testfmt.ts";
import type {
  RichAttrs,
  RichDoc,
  RichNode,
} from "@klats/shared/rich/RichView.tsx";
import { Fragment, type Node, type Schema, Slice } from "@tiptap/pm/model";
import type { PastedQuestion } from "./pasteParse";
import {
  HAS_BODY,
  HAS_CORRECT,
  HAS_IMAGE,
  HAS_OPTIONS,
  HAS_TARGETS,
} from "./types";

/*
 * The builder's pieces of a test document: new questions and options, and the
 * rich-text shapes the server stores (internal/rich).
 */

/** The points a question can carry, as internal/testfmt allows. */
export const MIN_POINTS = 1;
export const MAX_POINTS = 12;

/** Editor JSON as TipTap produces it: any node, possibly with attrs. */
export interface EditorNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type: string }[];
  content?: EditorNode[];
}

/**
 * The attrs internal/rich accepts, by node type. A node type not listed here
 * is stored without attrs.
 */
export const STORED_ATTRS: Record<string, (keyof RichAttrs)[]> = {
  image: ["src", "w", "h"],
  audio: ["src"],
  math: ["latex"],
  codeBlock: ["language"],
  gap: ["id"],
  tableHeader: ["colspan", "rowspan"],
  tableCell: ["colspan", "rowspan"],
};

/**
 * Returns `node` with only the keys internal/rich accepts: type, text, the
 * mark types of text nodes (ProseMirror also marks formulas and hard breaks,
 * which the server refuses), non-empty content, and for the node types in
 * {@link STORED_ATTRS} their listed attrs. Null attrs, spans of 1 and code
 * languages that are empty or not in {@link CODE_LANGUAGES} (the editor takes
 * one from a pasted `language-*` class or a typed ```fence) are dropped, as is
 * every attr of other nodes (so an ordered list always starts at 1 and a table
 * has no column widths).
 */
export function toStored(node: EditorNode): RichNode {
  const out: RichNode = { type: node.type ?? "" };
  const attrs: Record<string, unknown> = {};
  for (const key of STORED_ATTRS[out.type] ?? []) {
    const v = node.attrs?.[key];
    const span = key === "colspan" || key === "rowspan";
    const unknownLanguage =
      key === "language" && !CODE_LANGUAGES.some((l) => l.id === v);
    if (v != null && !(span && v === 1) && !unknownLanguage) attrs[key] = v;
  }
  if (Object.keys(attrs).length) out.attrs = attrs as RichAttrs;
  if (node.text !== undefined) out.text = node.text;
  if (node.text !== undefined && node.marks?.length) {
    out.marks = node.marks.map((m) => ({ type: m.type }));
  }
  if (node.content?.length) out.content = node.content.map(toStored);
  return out;
}

/**
 * Returns pasted `slice` as one paragraph, open at both ends so it merges into
 * the paragraph at the caret: an answer option holds a single paragraph. The
 * pasted paragraphs are joined by hard breaks, and empty ones are dropped.
 */
export function oneParagraph(slice: Slice, schema: Schema): Slice {
  const inline: Node[] = [];
  slice.content.forEach((block) => {
    if (block.isInline) inline.push(block);
    else if (block.childCount > 0) {
      if (inline.length > 0) inline.push(schema.nodes.hardBreak.create());
      block.forEach((n) => {
        inline.push(n);
      });
    }
  });
  const paragraph = schema.nodes.paragraph.create(null, inline);
  return new Slice(Fragment.from(paragraph), 1, 1);
}

/** Returns a document holding `text` as one paragraph, or one empty paragraph. */
export function textDoc(text: string): RichDoc {
  return {
    type: "doc",
    content: [
      text
        ? { type: "paragraph", content: [{ type: "text", text }] }
        : { type: "paragraph" },
    ],
  };
}

/** Returns the document's text on one line, formatting dropped. */
export function plainText(doc: RichDoc): string {
  return flat(doc).replace(/\s+/g, " ").trim();
}

function flat(n: RichNode | RichDoc): string {
  if (n.type === "text") return (n as RichNode).text ?? "";
  if (n.type === "hardBreak") return " ";
  const inner = (n.content ?? []).map(flat);
  return inner.join(n.type === "paragraph" ? "" : " ");
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Returns a random 16-character id for a question or option. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

export function newOption(text = "", correct = false): Option {
  return { id: newId(), content: textDoc(text), correct };
}

export function newTarget(text = ""): Target {
  return { id: newId(), content: textDoc(text), x: 0, y: 0 };
}

/**
 * Returns a question of `type` ready to edit: worth one point, with partial
 * credit and shuffling on, and the least its type needs to pass the checks
 * for missing items: two answers for single and multiple choice, two
 * statements, two rows and two columns, three items to order, two pairs, two
 * groups of one item each, or an empty body. A grid starts with no right
 * column marked.
 */
export function newQuestion(type: string): Question {
  const q: Question = {
    id: newId(),
    type,
    text: textDoc(""),
    points: MIN_POINTS,
    shuffleOptions: true,
    partial: true,
    options: [],
  };
  switch (type) {
    case "single":
    case "multi":
    case "truefalse":
      return { ...q, options: [newOption(), newOption()] };
    case "grid":
      return {
        ...q,
        options: [newOption(), newOption()],
        targets: [newTarget(), newTarget()],
      };
    case "order":
      return { ...q, options: [newOption(), newOption(), newOption()] };
    case "match":
    case "groups": {
      const targets = [newTarget(), newTarget()];
      const options = targets.map((t) => ({ ...newOption(), target: t.id }));
      return { ...q, options, targets };
    }
    case "gaps":
    case "bank":
    case "highlight":
      return { ...q, body: textDoc("") };
    default:
      return q;
  }
}

/**
 * Returns `q` as a question of `type`. It keeps the id, text, points, scoring
 * and shuffling, and what the two types share: the options' contents and
 * images; `correct` among single, multiple choice and true/false; the targets
 * and each option's target among grid, matching and grouping (matching keeps a
 * target for the first option that names it); the body among gaps, word bank
 * and highlight, without the target marks going to gaps or bank, and without
 * the gaps and formulas going to highlight; and the image between hotspot and
 * labels. Every other field starts as {@link newQuestion} has it.
 */
export function convertQuestion(q: Question, type: string): Question {
  const out: Question = {
    ...newQuestion(type),
    id: q.id,
    text: q.text,
    points: q.points,
    partial: q.partial,
    shuffleOptions: q.shuffleOptions,
  };
  if (HAS_OPTIONS.has(q.type) && HAS_OPTIONS.has(type) && q.options.length) {
    const correct = HAS_CORRECT.has(q.type) && HAS_CORRECT.has(type);
    const targeted = HAS_TARGETS.has(q.type) && HAS_TARGETS.has(type);
    const taken = new Set<string>();
    out.options = q.options.map((o) => {
      const kept: Option = {
        id: o.id,
        content: o.content,
        correct: correct && o.correct,
      };
      if (o.image) kept.image = o.image;
      if (targeted && o.target && !(type === "match" && taken.has(o.target))) {
        taken.add(o.target);
        kept.target = o.target;
      }
      return kept;
    });
    if (targeted) out.targets = q.targets ?? [];
  }
  if (HAS_BODY.has(q.type) && HAS_BODY.has(type) && q.body) {
    out.body = without(
      q.body,
      type === "highlight" ? ["gap", "math"] : ["target"],
    );
  }
  if (HAS_IMAGE.has(q.type) && HAS_IMAGE.has(type) && q.image) {
    out.image = q.image;
  }
  return out;
}

/** Returns `node` without the nodes and marks whose type is in `drop`. */
function without(node: RichNode, drop: string[]): RichNode {
  const out = { ...node };
  const marks = node.marks?.filter((x) => !drop.includes(x.type));
  if (marks?.length) out.marks = marks;
  else delete out.marks;
  if (node.content) {
    out.content = node.content
      .filter((n) => !drop.includes(n.type))
      .map((n) => without(n, drop));
  }
  return out;
}

/** Returns `items` with `item` put in at `index`, or at the end when that is past it. */
export function insertAt<T>(items: T[], index: number, item: T): T[] {
  const at = Math.min(index, items.length);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/** Turns parsed paste into questions, each worth one point. */
export function fromPasted(pasted: PastedQuestion[]): Question[] {
  return pasted.map((p) => ({
    ...newQuestion(p.type),
    text: textDoc(p.text),
    options: p.options.map((o) => newOption(o.text, o.correct)),
  }));
}
