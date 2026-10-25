import type { StudentTest } from "../generated/wire";
import { fieldsOf, walkNodes } from "../rich/walk";

/*
 * Code blocks are highlighted by lowlight, which the student app loads only
 * for a test that has a code block with a language, so shared code never
 * imports it. Each app registers a highlighter once; {@link CodeView} reads it
 * with `useSyncExternalStore` over {@link subscribeCode} and
 * {@link getHighlighter}, and redraws when one arrives.
 */

/** A language a code block can have, with the highlight.js grammar for it. */
interface CodeLanguage {
  /** The id stored in a code block's `language` attr. */
  id: string;
  /** The name of the highlight.js grammar that highlights it. */
  grammar: string;
  label: string;
}

/** The languages a code block can have; internal/rich accepts the same ids. */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: "python", grammar: "python", label: "Python" },
  { id: "cpp", grammar: "cpp", label: "C++" },
  { id: "pascal", grammar: "delphi", label: "Pascal" },
  { id: "javascript", grammar: "javascript", label: "JavaScript" },
  { id: "html", grammar: "xml", label: "HTML" },
  { id: "css", grammar: "css", label: "CSS" },
];

/**
 * The colour of each highlight.js token class (without its `hljs-` prefix).
 * Each meets 4.5:1 on every palette's `soft`, the background of a code block.
 */
export const TOKEN_COLOURS: Record<string, string> = {
  keyword: "#A6244A",
  string: "#0B6B3A",
  number: "#0B5EA8",
  comment: "#5B6470",
  title: "#7A3E00",
  built_in: "#0E6E73",
  literal: "#6A3FB5",
  attr: "#0B5EA8",
  tag: "#8A1F4E",
  name: "#8A1F4E",
  "selector-class": "#7A3E00",
  meta: "#5B6470",
};

/**
 * The part of a hast node that {@link CodeView} reads: text nodes carry
 * `value`, element nodes `properties.className` and `children`. lowlight's
 * trees fit it, without the shared package depending on the hast types.
 */
export interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/** Highlights `code` in the language with id `language`, as a hast root. */
type Highlighter = (code: string, language: string) => { children: HastNode[] };

let highlighter: Highlighter | null = null;
const listeners = new Set<() => void>();

/** Sets the function that highlights code, and redraws every code block shown. */
export function setHighlighter(fn: Highlighter): void {
  highlighter = fn;
  for (const l of listeners) l();
}

/** The registered highlighter, or null before one is set. */
export const getHighlighter = (): Highlighter | null => highlighter;

/** Subscribes to highlighter changes, as useSyncExternalStore takes it. */
export function subscribeCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reports whether any rich text of `test` holds a code block with a language. */
export function hasCode(test: StudentTest): boolean {
  let found = false;
  for (const f of fieldsOf(test)) {
    walkNodes(f.content, (n) => {
      found ||= n.type === "codeBlock" && !!n.attrs?.language;
    });
  }
  return found;
}
