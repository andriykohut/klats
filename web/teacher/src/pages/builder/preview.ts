import type { Question } from "@klats/shared/generated/testfmt.ts";
import type { StudentQuestion } from "@klats/shared/generated/wire.ts";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import { tokenize } from "./words";

/**
 * Returns `q` as a student's device receives it, for the builder's preview:
 * the same fields the server sends, none of the key, and the options and
 * targets in the teacher's order.
 */
export function toStudent(q: Question): StudentQuestion {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    options: q.options.map(({ id, content, image }) => ({
      id,
      content,
      image,
    })),
    targets: q.targets,
    // A highlight body carries its key as target marks; the server sends it
    // as word nodes without them, and so does the preview.
    body:
      q.type === "highlight" && q.body
        ? tokenize(q.body as RichDoc).doc
        : q.type === "gaps" || q.type === "bank"
          ? q.body
          : undefined,
    gaps: q.gaps?.map((g) => ({
      id: g.id,
      choices: g.choices?.map(({ id, text }) => ({ id, text })),
    })),
    image: q.image,
  };
}
