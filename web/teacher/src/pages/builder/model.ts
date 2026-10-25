import { CODE_LANGUAGES } from "@klats/shared/code/registry.ts";
import type { Option, Question } from "@klats/shared/generated/testfmt.ts";
import type {
  RichAttrs,
  RichDoc,
  RichNode,
} from "@klats/shared/rich/RichView.tsx";
import { Fragment, type Node, type Schema, Slice } from "@tiptap/pm/model";
import type { PastedQuestion } from "./pasteParse";

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

/** Returns an empty question of `type` with two empty options. */
export function newQuestion(type: "single" | "multi"): Question {
  return {
    id: newId(),
    type,
    text: textDoc(""),
    points: MIN_POINTS,
    shuffleOptions: true,
    partial: true,
    options: [newOption(), newOption()],
  };
}

/** Turns parsed paste into questions, each worth one point. */
export function fromPasted(pasted: PastedQuestion[]): Question[] {
  return pasted.map((p) => ({
    ...newQuestion(p.type),
    text: textDoc(p.text),
    options: p.options.map((o) => newOption(o.text, o.correct)),
  }));
}
