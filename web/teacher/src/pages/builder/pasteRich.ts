import { CODE_LANGUAGES } from "@klats/shared/code/registry.ts";
import type {
  RichDoc,
  RichMark,
  RichNode,
} from "@klats/shared/rich/RichView.tsx";

/*
 * The formatting pasted text may carry, read into the rich text internal/rich
 * stores. Inside a line: **bold**, _italic_ or *italic*, `code`, H~2~O for a
 * subscript, x^2^ for a superscript, and $…$ for a formula when no space
 * follows the opening sign or precedes the closing one and no digit follows
 * the closing one, so «$2 and $10» stays text. In a question's text, lines
 * starting with «|» are a table (a «|---|» row below the first makes it a
 * header row), and a code block runs from a «~~~language» line to a «~~~»
 * line. Anything that only looks like formatting stays text.
 */

/** A code block from pasted text: its first line, language label and code. */
export interface Fence {
  raw: string;
  language: string;
  code: string;
}

/**
 * How {@link inline} reads a line: `math: false` keeps `$…$` as text, and
 * `bracket` turns the inside of each `[…]` into a node; without it, or when
 * it returns null, the brackets stay text.
 */
export interface InlineOptions {
  math?: boolean;
  bracket?: (inner: string) => RichNode | null;
}

const INLINE = new RegExp(
  [
    String.raw`\\([!-/:-@[-\x60{-~])`,
    String.raw`\$(?=\S)([^$]*?\S)\$(?!\d)`,
    String.raw`\[([^\]]*)\]`,
    "`([^`]+)`",
    String.raw`\*\*(\S(?:.*?\S)?)\*\*(?![\p{L}\p{N}])`,
    String.raw`\*([^\s*](?:[^*]*?[^\s*])?)\*(?![\p{L}\p{N}])`,
    String.raw`_([^\s_](?:[^_]*?[^\s_])?)_(?![\p{L}\p{N}])`,
    String.raw`~([^\s~]+)~`,
    String.raw`\^([^\s^]+)\^`,
  ].join("|"),
  "gu",
);
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SEPARATOR = /^:?-+:?$/;

/**
 * Returns `text` as the inline nodes of a paragraph, each text node carrying
 * `marks` and those its formatting adds. A backslash before a punctuation
 * sign keeps the sign as text, and stars and underscores inside a word, as in
 * 3*4*5 or snake_case, are text too.
 */
export function inline(
  text: string,
  opts: InlineOptions = {},
  marks: RichMark[] = [],
): RichNode[] {
  const nodes: RichNode[] = [];
  // Adjacent text with the same marks becomes one node, as the editor keeps it.
  const add = (...made: RichNode[]) => {
    for (const n of made) {
      const last = nodes.at(-1);
      if (
        n.type === "text" &&
        last?.type === "text" &&
        JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])
      ) {
        last.text = `${last.text}${n.text}`;
      } else {
        nodes.push(n);
      }
    }
  };
  const textNode = (s: string, more: RichMark[] = []): RichNode => {
    const all = [...marks, ...more];
    return all.length
      ? { type: "text", text: s, marks: all }
      : { type: "text", text: s };
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const [
      whole,
      escaped,
      latex,
      inner,
      code,
      bold,
      starred,
      underscored,
      sub,
      sup,
    ] = m;
    const emphasis = bold ?? starred ?? underscored;
    if (emphasis !== undefined && WORD_CHAR.test(text[m.index - 1] ?? "")) {
      continue;
    }
    let made: RichNode[] | null;
    if (escaped !== undefined) {
      made = [textNode(escaped)];
    } else if (latex !== undefined) {
      made = opts.math === false ? null : [{ type: "math", attrs: { latex } }];
    } else if (inner !== undefined) {
      const node = opts.bracket?.(inner);
      made = node ? [node] : null;
    } else if (code !== undefined) {
      made = [textNode(code, [{ type: "code" }])];
    } else if (bold !== undefined) {
      made = inline(bold, opts, [...marks, { type: "bold" }]);
    } else if (sub !== undefined) {
      made = [textNode(sub, [{ type: "subscript" }])];
    } else if (sup !== undefined) {
      made = [textNode(sup, [{ type: "superscript" }])];
    } else {
      made = inline(starred ?? underscored, opts, [
        ...marks,
        { type: "italic" },
      ]);
    }
    if (!made) continue;
    if (at < m.index) add(textNode(text.slice(at, m.index)));
    add(...made);
    at = m.index + whole.length;
  }
  if (at < text.length) add(textNode(text.slice(at)));
  return nodes;
}

/** Returns `text` as one paragraph (see {@link inline}). */
export function paragraph(text: string, opts?: InlineOptions): RichNode {
  const content = inline(text, opts);
  return content.length
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

/** Returns `lines` as a document of one paragraph each (see {@link inline}). */
export function paragraphs(lines: string[], opts?: InlineOptions): RichDoc {
  return { type: "doc", content: lines.map((l) => paragraph(l, opts)) };
}

/**
 * Returns a question's text: consecutive lines joined into one paragraph,
 * with an empty line between paragraphs, lines starting with «|» as a table,
 * and each fence as a code block. No parts give one empty paragraph.
 */
export function questionText(parts: (string | Fence)[]): RichDoc {
  const content: RichNode[] = [];
  let words: string[] = [];
  let rows: string[] = [];
  const flush = () => {
    if (words.length) content.push(paragraph(words.join(" ")));
    if (rows.length) content.push(table(rows));
    words = [];
    rows = [];
  };
  for (const part of parts) {
    if (typeof part !== "string") {
      flush();
      content.push(codeBlock(part));
    } else if (!part) {
      flush();
    } else if (part.startsWith("|")) {
      if (words.length) flush();
      rows.push(part);
    } else {
      if (rows.length) flush();
      words.push(part);
    }
  }
  flush();
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

/**
 * Returns `text` without the star that marks an answer correct, and whether
 * it had one: a star at its start or end that does not open or close bold or
 * italic text, so «*Київ» and «Київ *» are marked and «*Київ*» is italic.
 */
export function correctMark(text: string): { text: string; star: boolean } {
  let t = text.trim();
  const spans = [...t.matchAll(INLINE)].filter((m) => m[0].startsWith("*"));
  let star = false;
  if (
    t.endsWith("*") &&
    !t.endsWith("\\*") &&
    !spans.some((m) => m.index + m[0].length === t.length)
  ) {
    t = t.slice(0, -1).trimEnd();
    star = true;
  }
  if (t.startsWith("*") && !spans.some((m) => m.index === 0)) {
    t = t.slice(1).trimStart();
    star = true;
  }
  return { text: t, star };
}

/** Returns table rows as a table, the rows above a «|---|» row as headers, every row as wide as the widest. */
function table(lines: string[]): RichNode {
  const cells = lines.map((l) =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim()),
  );
  const sep = cells.findIndex((r) => r.every((c) => SEPARATOR.test(c)));
  const rows = cells.filter((_, i) => i !== sep);
  const width = Math.max(...rows.map((r) => r.length));
  return {
    type: "table",
    content: rows.map((r, i) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, j) => ({
        type: i < sep ? "tableHeader" : "tableCell",
        content: [paragraph(r[j] ?? "")],
      })),
    })),
  };
}

/** Returns a fence as a code block, with its language when Klats knows it by id or name. */
function codeBlock(f: Fence): RichNode {
  const lang = CODE_LANGUAGES.find(
    (l) => l.id === f.language || l.label.toLowerCase() === f.language,
  );
  const node: RichNode = { type: "codeBlock" };
  if (lang) node.attrs = { language: lang.id };
  if (f.code) node.content = [{ type: "text", text: f.code }];
  return node;
}
