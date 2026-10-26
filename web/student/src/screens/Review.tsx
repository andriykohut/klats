import { isAnswered } from "@klats/shared/answers.ts";
import type { Answer } from "@klats/shared/generated/testfmt.ts";
import type { StudentTest } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { RichView } from "@klats/shared/rich/RichView.tsx";
import { popIn } from "@klats/shared/student-ui/motion.ts";
import { motion, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { Button } from "react-aria-components/Button";
import { Sheet } from "./ui";
import "@klats/shared/student-ui/AnswerTile.css";
import "@klats/shared/student-ui/QuestionSheet.css";

/**
 * The last stop before finishing: how many questions have an answer, and the
 * unanswered ones as tiles that lead back to them, or a note that none are
 * left. Without `onGo` the unanswered ones are flat cards that lead nowhere.
 * The student finishes the test from here, or returns to it. `timer` sits at
 * the sheet's top right, as on a question sheet.
 */
export function Review({
  test,
  answers,
  onGo,
  onBack,
  onFinish,
  timer,
}: {
  test: StudentTest;
  answers: Record<string, Answer>;
  onGo?: (index: number) => void;
  onBack: () => void;
  onFinish: () => void;
  timer?: ReactNode;
}) {
  const reduced = useReducedMotionConfig();
  const total = test.questions.length;
  const open = test.questions.flatMap((q, i) =>
    isAnswered(q, answers[q.id]) ? [] : [{ q, i }],
  );
  const answered = total - open.length;

  return (
    <Sheet className="s-review">
      <div className="k-sheet-main">
        <div className="k-sheet-scroll">
          <div>
            <div
              className={answered >= 10 ? "k-num k-num-small" : "k-num"}
              aria-hidden="true"
            >
              {answered}
            </div>
            <div className="k-of" aria-hidden="true">
              {m.review_answered({ count: answered, total })}
            </div>
            <span className="k-sr-only">
              {m.progress_value({ answered, total })}
            </span>
          </div>
          <div className="k-sheet-body">
            <span className="k-chip">
              {open.length > 0
                ? m.review_open({ count: open.length })
                : m.review_all_done()}
            </span>
            <h1 className="k-qtext">{m.review_title()}</h1>
            <div className="s-open">
              {open.map(({ q, i }, n) => {
                const face = (
                  <span className="k-face">
                    <span className="k-badge" aria-hidden="true">
                      <span className="k-badge-letter">{i + 1}</span>
                    </span>
                    <span className="k-tile-text">
                      <span className="s-open-label">
                        {m.review_question({ number: i + 1 })}
                      </span>
                      <span className="s-excerpt">
                        <RichView doc={q.text} />
                      </span>
                    </span>
                  </span>
                );
                return (
                  <motion.div
                    key={q.id}
                    className="k-tile-wrap"
                    {...popIn(0.22 + Math.min(n, 8) * 0.06, reduced)}
                  >
                    {onGo ? (
                      <Button className="k-tile" onPress={() => onGo(i)}>
                        {face}
                      </Button>
                    ) : (
                      <div className="k-tile">{face}</div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
        {timer && <div className="k-sheet-timer">{timer}</div>}
      </div>
      <div className="k-sheet-foot">
        <div className="k-actions">
          <button type="button" className="s-btn s-btn-quiet" onClick={onBack}>
            <span>{m.review_back()}</span>
          </button>
          <button type="button" className="s-btn" onClick={onFinish}>
            <span>{m.review_finish()}</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}
