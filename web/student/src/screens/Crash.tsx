import { m } from "@klats/shared/paraglide/messages.js";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportCrash } from "../api";
import { getState } from "../app";
import { ICONS, Notice } from "./ui";

/**
 * Renders its children until they throw while rendering, then a crash screen
 * in their place: it says the answers are saved, with a button that reloads
 * the page. The error and its stack go to the teacher's log, with the screen
 * it happened on, such as "test 2" for the second question.
 */
export class CrashBoundary extends Component<
  { children: ReactNode },
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
