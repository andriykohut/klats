/** A question read from pasted text, before it becomes part of a test. */
export interface PastedQuestion {
  text: string;
  type: "single" | "multi";
  options: { text: string; correct: boolean }[];
}

const QUESTION = /^\d+\s*[.)]\s*(.+)$/;
const OPTION = /^(\*?)\s*([а-яґєіїa-z])\s*\)\s*(\*?)\s*(.+?)\s*(\*?)$/i;

/**
 * Reads questions typed or copied from a document: each starts with a number
 * («1.» or «1)»), each answer with a letter («а)», «b)»), and a `*` before the
 * letter, after the bracket or at the end marks an answer correct. Lines
 * between a question and its first answer continue the question text; any
 * other line is skipped. Questions with no answers are dropped, and more than
 * one correct answer makes a question multi-answer.
 */
export function parsePasted(text: string): PastedQuestion[] {
  const out: PastedQuestion[] = [];
  let cur: PastedQuestion | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const q = QUESTION.exec(line);
    if (q) {
      cur = { text: q[1], type: "single", options: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const o = OPTION.exec(line);
    if (o) {
      cur.options.push({ text: o[4], correct: !!(o[1] || o[3] || o[5]) });
    } else if (cur.options.length === 0) {
      cur.text += ` ${line}`;
    }
  }
  for (const q of out) {
    if (q.options.filter((o) => o.correct).length > 1) q.type = "multi";
  }
  return out.filter((q) => q.options.length > 0);
}
