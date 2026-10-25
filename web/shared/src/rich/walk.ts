import type { Image } from "../generated/testfmt";
import type { StudentQuestion, StudentTest } from "../generated/wire";

/** A rich-text node, read without assuming its type is known. */
export interface WalkedNode {
  type?: string;
  attrs?: { src?: string; latex?: string };
  content?: WalkedNode[];
}

/** A rich document a question shows, or a picture it shows beside its text. */
export interface Field {
  content?: unknown;
  image?: Image;
}

/** A question as the server sends it, with the fields of every type. */
type Question = StudentQuestion & {
  body?: unknown;
  image?: Image;
  targets?: Field[];
};

/**
 * Returns the fields of `test` in reading order: each question's text and
 * body, its options and targets, then the question's own picture. A field has
 * a rich document, a picture, or both.
 */
export function fieldsOf(test: StudentTest): Field[] {
  const fields: Field[] = [];
  for (const q of test.questions as Question[]) {
    fields.push({ content: q.text }, { content: q.body });
    fields.push(...q.options, ...(q.targets ?? []), { image: q.image });
  }
  return fields;
}

/** Calls `visit` on `doc` and every node below it, parents before children. */
export function walkNodes(
  doc: unknown,
  visit: (node: WalkedNode) => void,
): void {
  const n = doc as WalkedNode | null;
  if (!n) return;
  visit(n);
  n.content?.forEach((c) => {
    walkNodes(c, visit);
  });
}
