import { useState } from "react";
import { m } from "../paraglide/messages.js";
import "./student-ui.css";
import "./Timer.css";

/**
 * The time left on a timed test, `remainingMs`, rounded up to the second: m:ss,
 * or h:mm:ss from an hour up, and 0:00 below zero. Under a minute it sets
 * `data-low`, and it turns the palette's accent. Screen readers hear it
 * politely when 5 minutes and when 1 minute are left, as the time crosses
 * each mark while it shows. It draws what it is given; the caller redraws it
 * as the time runs.
 */
export function Timer({ remainingMs }: { remainingMs: number }) {
  const left = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(left / 3600);
  const mins = Math.floor(left / 60) % 60;
  const secs = String(left % 60).padStart(2, "0");
  const warn = left <= 60 ? 1 : left <= 300 ? 5 : 0;
  // Each question mounts a new sheet, which must not repeat a mark already passed.
  const [mounted] = useState(warn);
  return (
    <>
      <div
        className="k-timer"
        role="timer"
        aria-label={m.timer_label()}
        data-low={left < 60 || undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2.5M10 2h4" />
        </svg>
        {hours > 0
          ? `${hours}:${String(mins).padStart(2, "0")}:${secs}`
          : `${mins}:${secs}`}
      </div>
      <p className="k-sr-only" role="status">
        {warn > 0 && warn !== mounted && m.timer_left({ count: warn })}
      </p>
    </>
  );
}
