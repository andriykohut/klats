import type { Problem, Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Button } from "react-aria-components";

type Say = (inputs: { number: number; count: number }) => string;

/** The problems whose wording names what the type is made of, by code and type. */
const BY_TYPE: Record<string, Record<string, Say>> = {
  no_body: {
    gaps: m.problem_no_body_gaps,
    bank: m.problem_no_body_gaps,
    highlight: m.problem_no_body_highlight,
  },
  too_few_options: {
    single: m.problem_too_few_options,
    multi: m.problem_too_few_options,
    truefalse: m.problem_too_few_statements,
    grid: m.problem_too_few_rows,
    order: m.problem_too_few_items,
    match: m.problem_too_few_pairs,
    groups: m.problem_too_few_items,
  },
  too_few_targets: {
    grid: m.problem_too_few_columns,
    groups: m.problem_too_few_groups,
  },
  empty_option: {
    single: m.problem_empty_option,
    multi: m.problem_empty_option,
    truefalse: m.problem_empty_statement,
    grid: m.problem_empty_row,
    order: m.problem_empty_item,
    match: m.problem_empty_pair,
    groups: m.problem_empty_group,
    bank: m.problem_empty_word,
    label: m.problem_empty_label,
  },
  no_target: {
    grid: m.problem_no_target_grid,
    match: m.problem_no_target_match,
    groups: m.problem_no_target_groups,
  },
  gap_no_answer: {
    gaps: m.problem_gap_no_answer_gaps,
    bank: m.problem_gap_no_answer_bank,
  },
};

/** The problems worded the same for every type, by code. */
const ANY_TYPE: Record<string, Say> = {
  no_text: m.problem_no_text,
  no_correct: m.problem_no_correct,
  single_many_correct: m.problem_single_many_correct,
  weak_partial: m.problem_weak_partial,
  no_accepted: m.problem_no_accepted,
  one_accepted: m.problem_one_accepted,
  no_number: m.problem_no_number,
  no_gaps: m.problem_no_gaps,
  no_image: m.problem_no_image,
  no_areas: m.problem_no_areas,
  no_points: m.problem_no_points,
  point_no_label: m.problem_point_no_label,
  no_words: m.problem_no_words,
};

/**
 * Returns what `p` means for question `number`, which has type `type`, in the
 * UI language. The wording names what the type is made of (statements, rows,
 * pairs), and the number in it is the problem's Count: the least a question
 * needs, or the number of the gap or point the problem is about. A code this
 * build does not know reads as the code itself.
 */
export function problemText(p: Problem, number: number, type: string): string {
  const say = BY_TYPE[p.code]?.[type] ?? ANY_TYPE[p.code];
  return say ? say({ number, count: p.count ?? 2 }) : p.code;
}

/**
 * The checks under the preview: every problem from the last save, red for
 * those that block starting and tangerine for warnings. Pressing one selects
 * its question; a single-answer question with several correct answers also
 * offers to become multi-answer. Problems of questions no longer in the test
 * are left out. Nothing shows for a test with no questions.
 */
export function Checks(props: {
  problems: Problem[];
  questions: Question[];
  onSelect: (questionId: string) => void;
  onMakeMulti: (questionId: string) => void;
}) {
  const number = new Map(props.questions.map((q, i) => [q.id, i + 1]));
  const type = new Map(props.questions.map((q) => [q.id, q.type]));
  const shown = props.problems.filter((p) => number.has(p.questionId));
  if (props.questions.length === 0) return null;
  return (
    <section className="b-checks">
      <h3>{shown.length ? m.checks_title() : m.checks_ok_title()}</h3>
      {shown.length === 0 ? (
        <p className="b-tip">{m.checks_ok()}</p>
      ) : (
        <ul>
          {shown.map((p) => (
            <li
              key={`${p.questionId} ${p.code} ${p.count ?? 0}`}
              className="b-tip"
              data-severity={p.severity}
            >
              <span>
                <Button
                  className="b-tip-link"
                  onPress={() => props.onSelect(p.questionId)}
                >
                  {problemText(
                    p,
                    number.get(p.questionId) ?? 0,
                    type.get(p.questionId) ?? "",
                  )}
                </Button>
                {p.code === "single_many_correct" && (
                  <Button
                    className="b-tip-fix"
                    onPress={() => props.onMakeMulti(p.questionId)}
                  >
                    {m.problem_make_multi()}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
