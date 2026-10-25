import {
  animate,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "motion/react";
import { useEffect } from "react";
import type { FinishResult } from "../generated/wire";
import { m } from "../paraglide/messages.js";
import { countUp, popIn, sheet } from "./motion";
import "./student-ui.css";
import "./FinishScreen.css";

const SCALE = 12;

/**
 * The finish sheet. With a result, the grade counts up inside a ring that
 * fills to grade / 12, beside how many answers were correct. With a pending
 * result (a written answer waits for the teacher) the ring shows «?» and the
 * sheet says the teacher will give the grade; the grade counts up when a
 * result without pending replaces it. With `null` (answers still waiting to
 * sync, so the server has not graded them) it shows a waiting ring and says
 * the grade will follow, and never a grade. A grade or a pending note that
 * arrives later is announced politely to screen readers.
 */
export function FinishScreen({ result }: { result: FinishResult | null }) {
  const reduced = useReducedMotionConfig();
  const grade = useMotionValue(0);
  const shown = useTransform(grade, Math.round);
  const graded = result && !result.pending ? result : null;
  const target = graded?.grade;

  useEffect(() => {
    if (target === undefined) return;
    if (reduced) {
      grade.set(target);
      return;
    }
    const run = animate(grade, target, countUp(false));
    return () => run.stop();
  }, [grade, target, reduced]);

  return (
    <motion.section className="k-sheet k-finish" {...sheet(reduced)}>
      <p className="k-sr-only" role="status">
        {graded ? m.finish_announce(graded) : result && m.finish_pending()}
      </p>
      <div
        className="k-ring"
        role="img"
        aria-label={
          graded ? m.finish_grade({ grade: graded.grade }) : undefined
        }
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
              animate={{ pathLength: graded.grade / SCALE }}
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
            <motion.span className="k-grade">
              {graded ? shown : "?"}
            </motion.span>
            {graded && (
              <span className="k-grade-of">{m.of_total({ total: SCALE })}</span>
            )}
          </div>
        )}
      </div>
      <div>
        <h2 className="k-finish-title">{m.finish_title()}</h2>
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
