import { CODE_LANGUAGES } from "@klats/shared/code/registry.ts";
import type {
  Choice,
  Gap,
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
  HAS_PARTIAL,
  HAS_SHUFFLE,
  HAS_TARGETS,
} from "./types";

/*
 * The builder's pieces of a test document: new questions and options, and the
 * rich-text shapes the server stores (internal/rich).
 */

/** The points a question can carry, as internal/testfmt allows. */
export const MIN_POINTS = 1;
export const MAX_POINTS = 12;

/** The longest a typed text may be, in characters, as internal/testfmt allows. */
export const MAX_TEXT = 200;

/** The longest a written-answer question's marking notes may be, in characters, as internal/testfmt allows. */
export const MAX_RUBRIC = 2000;

/** The most entries a list of texts, choices or gaps may hold, as internal/testfmt allows. */
export const MAX_LIST = 50;

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

/** Returns the ids of the gap nodes in `doc`, in document order. */
export function gapsInBody(doc: RichDoc): string[] {
  const ids: string[] = [];
  const walk = (n: RichNode) => {
    if (n.type === "gap" && n.attrs?.id) ids.push(n.attrs.id);
    n.content?.forEach(walk);
  };
  doc.content?.forEach(walk);
  return ids;
}

/**
 * Returns the entries of the gaps in `doc`, in body order, for a question's
 * `gaps`. An entry whose gap node is gone moves into `stash`, and a node that
 * has an entry there gets it back, so an undo restores a gap whole. A node
 * with no entry anywhere gets an empty one.
 */
export function syncGaps(
  gaps: Gap[] | undefined,
  doc: RichDoc,
  stash: Map<string, Gap>,
): Gap[] {
  const ids = gapsInBody(doc);
  // Only live entries are returned: the server rejects a list of over 50 or
  // with a repeated id before it drops the entries of removed gaps.
  for (const g of gaps ?? []) if (!ids.includes(g.id)) stash.set(g.id, g);
  return ids.map(
    (id) =>
      gaps?.find((g) => g.id === id) ?? stash.get(id) ?? ({ id } satisfies Gap),
  );
}

/**
 * Returns the range `from` to `to` of `doc` without the whitespace at its
 * ends, so a gap made of a double-clicked word (which some platforms select
 * with the space after it) leaves that space in the text. A range across
 * blocks, or of nothing but whitespace, is returned as it is.
 */
export function trimmedRange(
  doc: Node,
  from: number,
  to: number,
): { from: number; to: number } {
  if (!doc.resolve(from).sameParent(doc.resolve(to))) return { from, to };
  // An inline atom counts as one character, so offsets are positions.
  const text = doc.textBetween(from, to, "", "\uFFFC");
  if (!text.trim()) return { from, to };
  return {
    from: from + text.length - text.trimStart().length,
    to: to - (text.length - text.trimEnd().length),
  };
}

/**
 * Returns gap `g` as a list gap (`list`) or a typed one, carrying only the
 * fields of that mode: `choices` for a list gap (empty once all are removed,
 * and then still a list for the editor) and `accepted` for a typed gap. The
 * server grades a gap without choices by its accepted texts, so a list gap
 * must not keep any. `spare` is the entry as it was before the last switch;
 * it gives back the other mode's data when switching again. A new list gap
 * starts with the choices `blank` makes.
 */
export function gapInMode(
  g: Gap,
  list: boolean,
  spare: Gap | undefined,
  blank: () => Choice[],
): Gap {
  if (list) {
    return {
      id: g.id,
      choices: g.choices ?? (spare?.choices?.length ? spare.choices : blank()),
    };
  }
  const accepted = g.accepted ?? spare?.accepted;
  return accepted ? { id: g.id, accepted } : { id: g.id };
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
 * Returns `q` as a question of `type`. It keeps the id, text and points, the
 * partial-credit and shuffling choices when `q`'s type has them, and what the
 * two types share: the options' contents and images; `correct` among single,
 * multiple choice and true/false; the targets and each option's target among
 * grid, matching and grouping (matching keeps a target for the first option
 * that names it, and gives every other option a new empty one, so that each
 * pair has its own); the body among gaps, word bank and highlight, without the
 * target marks going to gaps or bank, and without the gaps and formulas going
 * to highlight; and the image between hotspot and labels. The tags stay,
 * whatever the type. Every other field starts as {@link newQuestion} has it.
 * Converting to the question's own type returns it as it is.
 */
export function convertQuestion(q: Question, type: string): Question {
  if (type === q.type) return q;
  const out: Question = {
    ...newQuestion(type),
    id: q.id,
    text: q.text,
    points: q.points,
  };
  if (q.tags) out.tags = q.tags;
  // The server clears a field its type does not use, so only a type that uses
  // it holds the teacher's choice.
  if (HAS_PARTIAL.has(q.type)) out.partial = q.partial;
  if (HAS_SHUFFLE.has(q.type)) out.shuffleOptions = q.shuffleOptions;
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
      const known = q.targets?.some((t) => t.id === o.target);
      if (
        targeted &&
        o.target &&
        known &&
        !(type === "match" && taken.has(o.target))
      ) {
        taken.add(o.target);
        kept.target = o.target;
      }
      return kept;
    });
    if (targeted) out.targets = q.targets ?? [];
    if (type === "match") {
      const targets = targeted ? [...(q.targets ?? [])] : [];
      out.options = out.options.map((o) => {
        if (o.target) return o;
        const t = newTarget();
        targets.push(t);
        return { ...o, target: t.id };
      });
      out.targets = targets;
    }
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

/**
 * Returns `words` with the target cleared on each word that names a gap of
 * `live` already named by a word in `taken` or by an earlier one of `words`,
 * so that no gap ends up with two words. A word whose target is not in `live`
 * is left as it is.
 */
export function clearTakenTargets(
  words: Option[],
  taken: Option[],
  live: string[],
): Option[] {
  const used = new Set(taken.map((o) => o.target));
  return words.map((o) => {
    if (!o.target || !live.includes(o.target)) return o;
    if (used.has(o.target)) return { ...o, target: "" };
    used.add(o.target);
    return o;
  });
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

/** Returns each tag of `questions` with how many questions carry it, in order of first appearance. */
export function tagCounts(questions: Question[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const q of questions) {
    for (const t of q.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts];
}

/**
 * Returns `tags` with `raw`, trimmed, added at the end. A blank `raw` or one
 * already in `tags` returns `tags` itself, or an empty list when it is
 * undefined.
 */
export function addTag(tags: string[] | undefined, raw: string): string[] {
  const tag = raw.trim();
  const all = tags ?? [];
  return !tag || all.includes(tag) ? all : [...all, tag];
}

/**
 * Returns the tag of `known` that `raw`, trimmed, names when case is ignored,
 * or `raw` trimmed when none does, so «мережі» joins a test's «Мережі».
 */
export function tagName(raw: string, known: string[]): string {
  const name = raw.trim();
  const lower = name.toLocaleLowerCase("uk");
  return known.find((t) => t.toLocaleLowerCase("uk") === lower) ?? name;
}

/** Returns `q` with `tag` added to its tags (see {@link addTag}). */
export function withTag(q: Question, tag: string): Question {
  return { ...q, tags: addTag(q.tags, tag) };
}

/**
 * Returns the first of `tags` joined by ", " in `shown`, as many whole tags as
 * stay within `max` characters but always at least one, and how many are left
 * out in `more`.
 */
export function tagLabel(
  tags: string[],
  max = 24,
): { shown: string; more: number } {
  let n = Math.min(1, tags.length);
  while (n < tags.length && tags.slice(0, n + 1).join(", ").length <= max) n++;
  return { shown: tags.slice(0, n).join(", "), more: tags.length - n };
}

/**
 * Returns the questions the list shows, each with its 1-based place in the
 * whole test: all of them when `shown` is null, those without a tag when it
 * is "", and otherwise those tagged `shown`. The question `selected` is always
 * among them.
 */
export function listed(
  questions: Question[],
  shown: string | null,
  selected: string,
): { question: Question; number: number }[] {
  return questions
    .map((question, i) => ({ question, number: i + 1 }))
    .filter(
      ({ question: q }) =>
        shown === null ||
        q.id === selected ||
        (shown === "" ? !q.tags?.length : !!q.tags?.includes(shown)),
    );
}
