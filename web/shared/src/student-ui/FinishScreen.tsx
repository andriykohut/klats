import {
  animate,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "motion/react";
import { useEffect } from "react";
import type { FinishResult } from "../generated/wire";
import { gradeFill, gradeText } from "../grades";
import { m } from "../paraglide/messages.js";
import { countUp, popIn, sheet } from "./motion";
import "./student-ui.css";
import "./FinishScreen.css";

/**
 * The finish sheet. With a result, the grade counts up inside a ring that
 * fills to the grade's share of its scale (see {@link gradeFill}), beside how
 * many answers were correct. On the pass/fail scale the ring holds a check and
 * is full for a pass, or a cross and empty for a fail, with the word under it.
 * With a pending result (a written answer waits for the teacher) the ring
 * shows «?» and the sheet says the teacher will give the grade; the grade
 * counts up when a result without pending replaces it. With `null` (answers still waiting to
 * sync, so the server has not graded them) it shows a waiting ring and says
 * the grade will follow, and never a grade. A grade or a pending note that
 * arrives later is announced politely to screen readers. With `timeUp` the
 * title is «Час вийшов» instead of «Тест завершено».
 */
export function FinishScreen({
  result,
  timeUp,
}: {
  result: FinishResult | null;
  timeUp?: boolean;
}) {
  const reduced = useReducedMotionConfig();
  const grade = useMotionValue(0);
  const shown = useTransform(grade, Math.round);
  const graded = result && !result.pending ? result : null;
  const target = graded?.grade;
  const scale = graded?.scale;
  const verdict = graded && scale === "pass" ? graded.grade === 1 : null;

  useEffect(() => {
    if (target === undefined) return;
    if (reduced) {
      grade.set(target);
      return;
    }
    const run = animate(grade, target, countUp(false));
    return () => run.stop();
  }, [grade, target, reduced]);

  const gradeName = graded ? gradeText(graded.scale, graded.grade) : "";

  return (
    <motion.section className="k-sheet k-finish" {...sheet(reduced)}>
      <p className="k-sr-only" role="status">
        {graded
          ? m.finish_announce({ ...graded, grade: gradeName })
          : result && m.finish_pending()}
      </p>
      <div className="k-finish-ring">
        <div
          className="k-ring"
          role="img"
          aria-label={graded ? m.finish_grade({ grade: gradeName }) : undefined}
          aria-hidden={graded ? undefined : true}
        >
          <svg viewBox="0 0 240 240" aria-hidden="true">
            <circle className="k-ring-track" cx="120" cy="120" r="100" />
            {graded ? (
              <motion.circle
                className="k-ring-fill"
                cx="120"
                cy="120"
                r="100"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: gradeFill(graded.scale, graded.grade) }}
                transition={countUp(reduced)}
              />
            ) : (
              !result && (
                <circle
                  className="k-ring-wait"
                  cx="120"
                  cy="120"
                  r="100"
                  pathLength={1}
                />
              )
            )}
          </svg>
          {result && (
            <div className="k-ring-label">
              {verdict !== null ? (
                <svg
                  className="k-verdict-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d={
                      verdict
                        ? "M5 12.5l4.5 4.5L19 7.5"
                        : "M6 6l12 12M18 6L6 18"
                    }
                  />
                </svg>
              ) : (
                <span className="k-grade">
                  {graded ? <motion.span>{shown}</motion.span> : "?"}
                  {scale === "percent" && "%"}
                </span>
              )}
              {scale === "points12" && (
                <span className="k-grade-of">{m.of_total({ total: 12 })}</span>
              )}
            </div>
          )}
        </div>
        {verdict !== null && <p className="k-verdict">{gradeName}</p>}
      </div>
      <div>
        <h2 className="k-finish-title">
          {timeUp ? m.finish_time_up() : m.finish_title()}
        </h2>
        {result?.pending && (
          <p className="k-finish-note">{m.finish_pending()}</p>
        )}
        <div className="k-finish-chips">
          {graded ? (
            <>
              <motion.span className="k-fchip" {...popIn(0.9, reduced)}>
                {m.finish_correct({
                  correct: graded.correct,
                  total: graded.total,
                })}
              </motion.span>
              <motion.span className="k-fchip" {...popIn(0.99, reduced)}>
                <i className="k-dot k-dot-ok" />
                {m.finish_sent()}
              </motion.span>
            </>
          ) : result ? (
            <motion.span className="k-fchip" {...popIn(0.9, reduced)}>
              <i className="k-dot k-dot-ok" />
              {m.finish_sent()}
            </motion.span>
          ) : (
            <motion.span className="k-fchip" {...popIn(0.9, reduced)}>
              <i className="k-dot" />
              {m.finish_waiting()}
            </motion.span>
          )}
        </div>
      </div>
    </motion.section>
  );
}
