import type { Problem, Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Button } from "react-aria-components";

/**
 * Returns what `p` means for question `number`, in the UI language. A code
 * this build does not know reads as the code itself.
 */
export function problemText(p: Problem, number: number): string {
  switch (p.code) {
    case "no_text":
      return m.problem_no_text({ number });
    case "no_correct":
      return m.problem_no_correct({ number });
    case "too_few_options":
      return m.problem_too_few_options({ number });
    case "single_many_correct":
      return m.problem_single_many_correct({ number, count: p.count ?? 2 });
    case "empty_option":
      return m.problem_empty_option({ number });
    case "weak_partial":
      return m.problem_weak_partial({ number });
    default:
      return p.code;
  }
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
              key={`${p.questionId} ${p.code}`}
              className="b-tip"
              data-severity={p.severity}
            >
              <span>
                <button
                  type="button"
                  className="b-tip-link"
                  onClick={() => props.onSelect(p.questionId)}
                >
                  {problemText(p, number.get(p.questionId) ?? 0)}
                </button>
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
