import type {
  Gap,
  NumberKey,
  Option,
  Question,
  Target,
} from "@klats/shared/generated/testfmt.ts";
import { locales } from "@klats/shared/paraglide/runtime.js";
import { addTag, MAX_POINTS, MIN_POINTS, newId, newQuestion } from "./model";
import { correctMark, type Fence, paragraphs, questionText } from "./pasteRich";
import { HAS_BODY, HAS_IMAGE, TYPE_INFO } from "./types";

/*
 * The text a teacher types, copies from a document or gets from a chatbot,
 * read into questions of every type that needs no picture. Each question
 * starts with a number («1.» or «1)»), then optionally a type's name in square
 * brackets, as the builder's type picker shows it in either language; a
 * question without one is single or multiple choice. Then come its lines:
 *
 *   а) answer, or - item   an answer, a statement, an item to order, or a pair
 *                          («•» works as «-»)
 *   *                      before the letter, after the bracket or at the end
 *                          marks an answer correct or a statement true
 *   left -> right          the pair, group or column an item belongs to
 *   = text                 an accepted answer, the number key («3,14»,
 *                          «3,14 ± 0,01», «3..4») or a written answer's notes
 *   ~ text                 an extra that nothing belongs to: a spare pair,
 *                          word, group or column
 *   Бали: 2 / Points: 2    the question's points
 *   Теги: a, b / Tags: …   its tags
 *
 * In gaps, word bank and highlight questions the question line is the task
 * and the lines after it are the text, each a paragraph, lettered and dashed
 * lines included. A task alone on the line after a bare type name works too.
 * There `[…]` puts the answer in its place: a gap's accepted spellings split
 * by «|», or its list with the right entry starred; a word bank's word; a
 * highlighted word.
 *
 * Questions, answers and text carry the formatting pasteRich reads; a
 * question's text may also hold tables and code blocks. Accepted answers,
 * number keys, notes and tags are plain text.
 */

/** A question read from pasted text, with what the paste box shows of it. */
export interface PastedQuestion {
  question: Question;
  /** The question's text on one line; empty for a text question with no task. */
  title: string;
  /** Its answers, items or text as typed, the right answers marked. */
  rows: { text: string; correct: boolean }[];
}

/**
 * Why a line was left out: not a line the question's type reads (`line`), an
 * unknown type name (`type`), a type that needs a picture (`picture`), a
 * question with nothing to answer (`empty`), a number key that is not a
 * number (`number`), or points outside 1-12 (`points`).
 */
export type SkipReason =
  | "line"
  | "type"
  | "picture"
  | "empty"
  | "number"
  | "points";

/** The questions read from pasted text, and the lines left out. */
export interface Pasted {
  questions: PastedQuestion[];
  skipped: { line: string; reason: SkipReason }[];
}

const QUESTION = /^\d+\s*[.)](?!\d)\s*(.*)$/;
const TYPE_NAME = /^\[([^\]]+)\]\s*(.*)$/;
const LETTERED = /^(\*?)\s*[а-яґєіїa-z]\s*\)\s*(.+)$/i;
const DASHED = /^[-•]\s+(.+)$/;
const KEY = /^=\s*(.*)$/;
const EXTRA = /^~\s*(.+)$/;
const POINTS = /^(?:бали|points)\s*:\s*(.*)$/i;
const TAGS = /^(?:теги|tags)\s*:\s*(.*)$/i;
const ARROW = /\s*(?:->|→)\s*/;
const FENCE = /^~~~\s*([^\s~]*)\s*$/;
const BACKTICKS = /^```/;

const NUM = String.raw`[-−]?\d+(?:[.,]\d+)?`;
const EXACT = new RegExp(`^(${NUM})$`);
const TOLERANCE = new RegExp(
  String.raw`^(${NUM})\s*(?:±|\+-|\+/-)\s*(${NUM})$`,
);
const RANGE = new RegExp(String.raw`^(${NUM})\s*(?:\.\.|…)\s*(${NUM})$`);

interface Line {
  raw: string;
  text: string;
  star: boolean;
}

/**
 * Reads `text` into questions, each worth one point unless it says otherwise.
 * A question with nothing to answer for its type, an unknown type name or a
 * type that needs a picture is left out whole and listed in `skipped` by its
 * number line. A line before the first question, or one its question's type
 * does not read, is listed there too. A blank line starts a new paragraph in
 * a question's text and is ignored elsewhere, and a line starting with ```
 * is always ignored.
 */
export function parsePasted(text: string): Pasted {
  const out: Pasted = { questions: [], skipped: [] };
  const blocks: { raw: string; head: string; lines: (string | Fence)[] }[] = [];
  const add = (line: string | Fence) => {
    const block = blocks.at(-1);
    if (block) block.lines.push(line);
    else {
      out.skipped.push({
        line: typeof line === "string" ? line : line.raw,
        reason: "line",
      });
    }
  };
  // A code block keeps its lines as they are, blank and indented ones too,
  // until its closing «~~~» or the end of the text.
  let fence: { raw: string; language: string; code: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (fence) {
      if (line.startsWith("~~~")) {
        add({ ...fence, code: fence.code.join("\n") });
        fence = null;
      } else {
        fence.code.push(raw.trimEnd());
      }
      continue;
    }
    if (!line) {
      // A blank line in a question's text starts a new paragraph.
      const block = blocks.at(-1);
      if (block && block.lines.at(-1) !== "") block.lines.push("");
      continue;
    }
    // The ``` lines of the chatbot's code block often come along when its
    // reply is copied; code in questions is fenced with ~~~ instead.
    if (BACKTICKS.test(line)) continue;
    const open = FENCE.exec(line);
    if (open) {
      fence = { raw: line, language: open[1].toLowerCase(), code: [] };
      continue;
    }
    const q = QUESTION.exec(line);
    if (q) blocks.push({ raw: line, head: q[1] ?? "", lines: [] });
    else add(line);
  }
  if (fence) add({ ...fence, code: fence.code.join("\n") });
  for (const b of blocks) {
    const found = read(b.raw, b.head, b.lines, (line, reason) =>
      out.skipped.push({ line, reason }),
    );
    if (found) out.questions.push(found);
  }
  return out;
}

function read(
  raw: string,
  head: string,
  lines: (string | Fence)[],
  skip: (line: string, reason: SkipReason) => void,
): PastedQuestion | null {
  let type: string | undefined;
  const named = TYPE_NAME.exec(head);
  if (named) {
    type = typeNamed(named[1]);
    const problem = !type ? "type" : HAS_IMAGE.has(type) ? "picture" : null;
    if (problem) {
      skip(raw, problem);
      return null;
    }
    head = named[2];
  }

  const text: (string | Fence)[] = [];
  const items: Line[] = [];
  const keys: Line[] = [];
  const extras: Line[] = [];
  let points = MIN_POINTS;
  let tags: string[] = [];
  // Text questions have no answer lines, so a dialogue or a list in the text
  // stays text.
  const prose = type !== undefined && HAS_BODY.has(type);
  for (const line of lines) {
    if (typeof line !== "string") {
      if (items.length || keys.length || extras.length) skip(line.raw, "line");
      else text.push(line);
      continue;
    }
    if (!line) {
      if (!items.length && !keys.length && !extras.length) text.push(line);
      continue;
    }
    const pts = POINTS.exec(line);
    const tagged = TAGS.exec(line);
    const key = KEY.exec(line);
    const extra = EXTRA.exec(line);
    const lettered = prose ? null : LETTERED.exec(line);
    const dashed = prose ? null : DASHED.exec(line);
    if (pts) {
      const n = Number(pts[1]);
      if (Number.isInteger(n) && n >= MIN_POINTS && n <= MAX_POINTS) points = n;
      else skip(line, "points");
    } else if (tagged) {
      for (const tag of tagged[1].split(",")) tags = addTag(tags, tag);
    } else if (key) {
      keys.push({ raw: line, text: key[1].trim(), star: false });
    } else if (extra) {
      extras.push({ raw: line, text: extra[1].trim(), star: false });
    } else if (lettered) {
      items.push(item(line, lettered[2], lettered[1] === "*"));
    } else if (dashed) {
      items.push(item(line, dashed[1], false));
    } else if (items.length || keys.length || extras.length) {
      skip(line, "line");
    } else {
      text.push(line);
    }
  }

  const t =
    type ?? (items.filter((i) => i.star).length > 1 ? "multi" : "single");
  const parts = head ? [head, ...text] : text;
  let title = parts
    .filter((p) => typeof p === "string" && p && !p.startsWith("|"))
    .join(" ");
  let content = questionText(parts);
  let body: string[] = [];
  if (HAS_BODY.has(t)) {
    // A text question's text holds no tables or code blocks.
    for (const p of text) if (typeof p !== "string") skip(p.raw, "line");
    [title, body] = [
      head,
      text.filter((p): p is string => typeof p === "string" && p !== ""),
    ];
    if (!title && body.length > 1 && !body[0].includes("[")) {
      [title, ...body] = body;
    } else if (!body.length && head.includes("[")) {
      [title, body] = ["", [head]];
    }
    content = paragraphs([title]);
  }

  const base: Question = { ...newQuestion(t), text: content, points };
  if (tags.length) base.tags = tags;
  const built = build(t, base, { items, keys, extras, body }, skip);
  if (!built) {
    skip(raw, "empty");
    return null;
  }
  return { question: built.question, title, rows: built.rows };
}

/** Returns an answer line without the star that marks it correct, and whether it had one. */
function item(raw: string, text: string, starredBefore: boolean): Line {
  const m = correctMark(text);
  return { raw, text: m.text, star: starredBefore || m.star };
}

type Rows = PastedQuestion["rows"];

function build(
  type: string,
  q: Question,
  {
    items,
    keys,
    extras,
    body,
  }: { items: Line[]; keys: Line[]; extras: Line[]; body: string[] },
  skip: (line: string, reason: SkipReason) => void,
): { question: Question; rows: Rows } | null {
  const unused = (...groups: Line[][]) => {
    for (const l of groups.flat()) skip(l.raw, "line");
  };
  const plain = (lines: Line[], correct = false): Rows =>
    lines.map((l) => ({ text: l.text, correct }));
  switch (type) {
    case "single":
    case "multi":
    case "truefalse": {
      unused(keys, extras);
      if (!items.length) return null;
      const options = items.map((i) => option(i.text, i.star));
      return {
        question: { ...q, options },
        rows: items.map((i) => ({ text: i.text, correct: i.star })),
      };
    }
    case "order": {
      unused(keys, extras);
      if (!items.length) return null;
      return {
        question: { ...q, options: items.map((i) => option(i.text)) },
        rows: items.map((i, n) => ({
          text: `${n + 1}. ${i.text}`,
          correct: false,
        })),
      };
    }
    case "match":
    case "groups":
    case "grid": {
      unused(keys);
      const targets: Target[] = [];
      const named = new Map<string, string>();
      // Matching gives each pair its own right-hand side, as an answer uses
      // each once; groups and columns are shared by the items naming them.
      const where = (name: string) => {
        let id = type === "match" ? undefined : named.get(name);
        if (!id) {
          const t = target(name);
          targets.push(t);
          named.set(name, t.id);
          id = t.id;
        }
        return id;
      };
      const options: Option[] = [];
      const rows: Rows = [];
      for (const i of items) {
        const [left, right] = i.text.split(ARROW, 2);
        if (!left || !right) {
          skip(i.raw, "line");
          continue;
        }
        options.push(option(left, false, where(right)));
        rows.push({ text: `${left} → ${right}`, correct: false });
      }
      if (!options.length) return null;
      for (const e of extras) {
        where(e.text);
        rows.push({ text: `→ ${e.text}`, correct: false });
      }
      return { question: { ...q, options, targets }, rows };
    }
    case "short": {
      unused(items, extras);
      const accepted = keys.filter((k) => k.text);
      if (!accepted.length) return null;
      return {
        question: { ...q, accepted: accepted.map((k) => k.text) },
        rows: plain(accepted, true),
      };
    }
    case "number": {
      unused(items, extras);
      const [first, ...rest] = keys;
      unused(rest);
      if (!first) return null;
      const number = numberKey(first.text);
      if (!number) {
        skip(first.raw, "number");
        return null;
      }
      return { question: { ...q, number }, rows: plain([first], true) };
    }
    case "open": {
      unused(items, extras);
      return {
        question: { ...q, rubric: keys.map((k) => k.text).join("\n") },
        rows: plain(keys),
      };
    }
    case "gaps": {
      unused(items, keys, extras);
      const gaps: Gap[] = [];
      const content = paragraphs(body, {
        bracket: (inner) => {
          const id = newId();
          const alts = inner
            .split("|")
            .map((a) => correctMark(a))
            .filter((a) => a.text);
          if (alts.some((a) => a.star)) {
            const choices = alts.map((a) => ({
              id: newId(),
              text: a.text,
              correct: a.star,
            }));
            gaps.push({ id, choices });
          } else {
            gaps.push({ id, accepted: alts.map((a) => a.text) });
          }
          return { type: "gap", attrs: { id } };
        },
      });
      if (!gaps.length) return null;
      return {
        question: { ...q, body: content, gaps },
        rows: body.map((text) => ({ text, correct: false })),
      };
    }
    case "bank": {
      unused(items, keys);
      const options: Option[] = [];
      const content = paragraphs(body, {
        bracket: (inner) => {
          const id = newId();
          options.push(option(inner.trim(), false, id));
          return { type: "gap", attrs: { id } };
        },
      });
      if (!options.length) return null;
      for (const e of extras) options.push(option(e.text));
      return {
        question: { ...q, body: content, options },
        rows: [
          ...body.map((text) => ({ text, correct: false })),
          ...extras.map((e) => ({ text: `~ ${e.text}`, correct: false })),
        ],
      };
    }
    case "highlight": {
      unused(items, keys, extras);
      let marked = 0;
      const content = paragraphs(body, {
        math: false,
        bracket: (inner) => {
          if (!inner.trim()) return null;
          marked++;
          return { type: "text", text: inner, marks: [{ type: "target" }] };
        },
      });
      if (!marked) return null;
      return {
        question: { ...q, body: content },
        rows: body.map((text) => ({ text, correct: false })),
      };
    }
  }
  return null;
}

/**
 * Returns the question type `name` names in any language, ignoring case, or
 * undefined when it names none.
 */
function typeNamed(name: string): string | undefined {
  const want = name.toLocaleLowerCase("uk").replace(/\s+/g, " ").trim();
  return Object.keys(TYPE_INFO).find((type) =>
    locales.some(
      (locale) =>
        TYPE_INFO[type].name({}, { locale }).toLocaleLowerCase("uk") === want,
    ),
  );
}

function numberKey(text: string): NumberKey | null {
  const n = (s: string) => Number(s.replace(",", ".").replace("−", "-"));
  const key = { mode: "exact", value: 0, tolerance: 0, min: 0, max: 0 };
  const exact = EXACT.exec(text);
  if (exact) return { ...key, value: n(exact[1]) };
  const within = TOLERANCE.exec(text);
  if (within) {
    return {
      ...key,
      mode: "tolerance",
      value: n(within[1]),
      tolerance: n(within[2]),
    };
  }
  const range = RANGE.exec(text);
  return range
    ? { ...key, mode: "range", min: n(range[1]), max: n(range[2]) }
    : null;
}

function option(text: string, correct = false, target?: string): Option {
  const o: Option = { id: newId(), content: paragraphs([text]), correct };
  return target ? { ...o, target } : o;
}

function target(text: string): Target {
  return { id: newId(), content: paragraphs([text]), x: 0, y: 0 };
}
