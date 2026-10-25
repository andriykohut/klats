import type {
  RichDoc,
  RichMark,
  RichNode,
} from "@klats/shared/rich/RichView.tsx";

/** Letters, decimal digits and marks: the characters a word is made of. */
const WORD_CHAR = /^[\p{L}\p{Nd}\p{M}]$/u;

/** The apostrophes and hyphens that join two word characters into one word. */
const JOINERS = "'’-‐‑";

/** A character of a paragraph's text, with its text node's marks other than target. */
interface Char {
  ch: string;
  marks: RichMark[];
  target: boolean;
}

/**
 * Returns `doc` with the words of each paragraph split out as word nodes
 * (formatting that covers part of a word stays inside it as text nodes of its
 * own) and without the target mark, as the student's device receives a
 * highlight body, plus the indexes of the words that had any character
 * marked. A word is a run of letters, digits and marks, with an apostrophe or
 * hyphen of {@link JOINERS} between two of them; every other character, a
 * hard break, any other inline node and a paragraph end ends a word.
 *
 * shortcut: the preview's own copy of rich.Doc.Words (internal/rich/words.go),
 * so it must change whenever Go's rule does; the server stays the only one that
 * numbers words for grading.
 */
export function tokenize(doc: RichDoc): { doc: RichDoc; targets: number[] } {
  const targets: number[] = [];
  let words = 0;

  const splitRun = (run: Char[]): RichNode[] => {
    const inWord = run.map(
      (c, i) =>
        WORD_CHAR.test(c.ch) ||
        (JOINERS.includes(c.ch) &&
          i > 0 &&
          i + 1 < run.length &&
          WORD_CHAR.test(run[i - 1].ch) &&
          WORD_CHAR.test(run[i + 1].ch)),
    );
    const out: RichNode[] = [];
    for (let i = 0; i < run.length; ) {
      let j = i + 1;
      while (j < run.length && inWord[j] === inWord[i]) j++;
      const texts = textRuns(run.slice(i, j));
      if (inWord[i]) {
        if (run.slice(i, j).some((c) => c.target)) targets.push(words);
        words++;
        out.push({ type: "word", content: texts });
      } else out.push(...texts);
      i = j;
    }
    return out;
  };

  const paragraph = (inline: RichNode[]): RichNode[] => {
    const out: RichNode[] = [];
    let run: Char[] = [];
    for (const n of inline) {
      if (n.type !== "text") {
        out.push(...splitRun(run), n);
        run = [];
        continue;
      }
      const marks = (n.marks ?? []).filter((x) => x.type !== "target");
      const target = (n.marks ?? []).some((x) => x.type === "target");
      for (const ch of n.text ?? "") run.push({ ch, marks, target });
    }
    return [...out, ...splitRun(run)];
  };

  const blocks = (nodes: RichNode[]): RichNode[] =>
    nodes.map((n) => {
      if (!n.content) return n;
      return {
        ...n,
        content:
          n.type === "paragraph" ? paragraph(n.content) : blocks(n.content),
      };
    });

  return { doc: { ...doc, content: blocks(doc.content ?? []) }, targets };
}

/** Returns `chars` as text nodes, one for each run of equal marks. */
function textRuns(chars: Char[]): RichNode[] {
  const key = (c: Char) => c.marks.map((x) => x.type).join();
  const out: RichNode[] = [];
  for (let i = 0; i < chars.length; ) {
    let j = i;
    let text = "";
    for (; j < chars.length && key(chars[j]) === key(chars[i]); j++) {
      text += chars[j].ch;
    }
    out.push({
      type: "text",
      text,
      ...(chars[i].marks.length ? { marks: chars[i].marks } : {}),
    });
    i = j;
  }
  return out;
}
