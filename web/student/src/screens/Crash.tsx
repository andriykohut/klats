import { m } from "@klats/shared/paraglide/messages.js";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportCrash } from "../api";
import { getState } from "../app";
import { ICONS, Notice } from "./ui";

/**
 * Renders its children until they throw while rendering, then `fallback` in
 * their place: `null` renders nothing, and `undefined` renders the crash
 * screen, which says the answers are saved, with a button that reloads the
 * page. Either way the error and its stack go to the teacher's log, with the
 * screen it happened on, such as "test 2" for the second question.
 */
export class CrashBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const e = error instanceof Error ? error : undefined;
    const { screen, index } = getState();
    reportCrash({
      message: e ? e.message : String(error),
      stack: `${e?.stack ?? ""}\n${info.componentStack ?? ""}`,
      page: screen.name === "test" ? `test ${index + 1}` : screen.name,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <main className="s-slot">
        <Notice icon={ICONS.broken} title={m.crash_title()}>
          <p className="s-lead">{m.crash_student_text()}</p>
          <div className="s-actions">
            <button
              type="button"
              className="s-btn"
              onClick={() => location.reload()}
            >
              <span>{m.crash_reload()}</span>
            </button>
          </div>
        </Notice>
      </main>
    );
  }
}

/**
 * Stands in for a question that threw while rendering: one button leads on to
 * the next question, or to the review after the last one.
 */
export function BrokenQuestion({
  last,
  onNext,
}: {
  last: boolean;
  onNext: () => void;
}) {
  return (
    <Notice icon={ICONS.broken} title={m.crash_question_title()}>
      <p className="s-lead">{m.crash_question_text()}</p>
      <div className="s-actions">
        <button type="button" className="s-btn" onClick={onNext}>
          <span>{last ? m.test_finish() : m.test_next()}</span>
        </button>
      </div>
    </Notice>
  );
}
