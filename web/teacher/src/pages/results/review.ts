import type { Answer, Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import { gapsInBody } from "../builder/model";

/**
 * One line of an answer review: what the question asked, what the student
 * gave (null when nothing), what is right, and whether the server judged the
 * given part right (null when it judged none).
 */
export interface ReviewRow {
  prompt: RichDoc | string;
  given: RichDoc | string | null;
  expected: RichDoc | string;
  ok: boolean | null;
}

/**
 * Returns the review lines of the answer `a` to `q` for the types that list
 * their parts: true/false, grid, matching, grouping, gaps, word bank, labels,
 * short text and number. The other types have a view of their own and give no
 * lines. `ok` is the server's verdict of the part, keyed as grading.Verdict
 * keys it (option or gap id, `""` for a single text); the teacher UI never
 * compares answers itself.
 */
export function reviewRows(
  q: Question,
  a: Answer | undefined,
  verdicts: Record<string, boolean> | undefined,
): ReviewRow[] {
  const ok = (id: string) => verdicts?.[id] ?? null;
  const pairs = a?.pairs ?? {};
  const side = (id: string | undefined): RichDoc | string =>
    q.targets?.find((t) => t.id === id)?.content ?? "";
  const option = (id: string | undefined): RichDoc | string =>
    q.options.find((o) => o.id === id)?.content ?? "";
  const gaps = q.body ? gapsInBody(q.body) : [];

  switch (q.type) {
    case "truefalse": {
      const word = (v: boolean) => (v ? m.answer_true() : m.answer_false());
      return q.options.map((o) => ({
        prompt: o.content,
        given: pairs[o.id] ? word(pairs[o.id] === "true") : null,
        expected: word(o.correct),
        ok: ok(o.id),
      }));
    }
    case "grid":
    case "match":
    case "groups":
      return q.options.map((o) => ({
        prompt: o.content,
        given: pairs[o.id] ? side(pairs[o.id]) : null,
        expected: side(o.target),
        ok: ok(o.id),
      }));
    case "gaps":
      return gaps.map((id, i) => {
        const gap = q.gaps?.find((g) => g.id === id);
        const choices = gap?.choices ?? [];
        const typed = choices.length === 0;
        const put = pairs[id];
        return {
          prompt: m.review_gap({ number: i + 1 }),
          given: !put
            ? null
            : typed
              ? put
              : (choices.find((c) => c.id === put)?.text ?? ""),
          expected: typed
            ? (gap?.accepted ?? []).join(" / ")
            : choices
                .filter((c) => c.correct)
                .map((c) => c.text)
                .join(" / "),
          ok: ok(id),
        };
      });
    case "bank":
      return gaps.map((id, i) => ({
        prompt: m.review_gap({ number: i + 1 }),
        given: pairs[id] ? option(pairs[id]) : null,
        expected: q.options.find((o) => o.target === id)?.content ?? "",
        ok: ok(id),
      }));
    case "label":
      return (q.targets ?? []).map((t, i) => {
        const placed = Object.keys(pairs).find(
          (label) => pairs[label] === t.id,
        );
        return {
          prompt: m.review_point({ number: i + 1 }),
          given: placed ? option(placed) : null,
          expected: option(q.options.find((o) => o.target === t.id)?.id),
          ok: placed ? ok(placed) : null,
        };
      });
    case "short":
      return [
        {
          prompt: m.review_answer(),
          given: a?.text?.trim() ? a.text : null,
          expected: (q.accepted ?? []).join(" / "),
          ok: ok(""),
        },
      ];
    case "number":
      return [
        {
          prompt: m.review_answer(),
          given: a?.text?.trim() ? a.text : null,
          expected: numberKey(q),
          ok: ok(""),
        },
      ];
    default:
      return [];
  }
}

/** Returns the right answer of a number question as the teacher set it: «8», «3,14 ± 0,01» or «1 – 5». */
function numberKey(q: Question): string {
  const key = q.number;
  if (!key) return "";
  const n = (v: number) =>
    new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 10 }).format(v);
  if (key.mode === "range") return `${n(key.min)} – ${n(key.max)}`;
  if (key.mode === "tolerance") return `${n(key.value)} ± ${n(key.tolerance)}`;
  return n(key.value);
}
