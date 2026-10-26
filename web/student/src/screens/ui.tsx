import type { JoinInfo } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { sheet } from "@klats/shared/student-ui/motion.ts";
import { motion, useReducedMotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { NameTaken } from "../api";
import { ApiError } from "../sync/connection";
import "@klats/shared/student-ui/student-ui.css";
import "@klats/shared/student-ui/FinishScreen.css";

/**
 * The white sheet every screen sits on. It slides in and out like a question
 * sheet, so wrap screens in `<AnimatePresence mode="wait">`.
 */
export function Sheet({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotionConfig();
  return (
    <motion.section className={`k-sheet ${className}`} {...sheet(reduced)}>
      {children}
    </motion.section>
  );
}

/**
 * A sheet laid out like the finish screen: an icon in a ring, which draws
 * itself in, beside a title and whatever the screen adds below it. `icon` is
 * the path data of 24×24 stroked icon lines.
 */
export function Notice({
  icon,
  title,
  children,
}: {
  icon: string[];
  title: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotionConfig();
  return (
    <Sheet className="k-finish">
      <div className="k-ring" aria-hidden="true">
        <svg viewBox="0 0 240 240" aria-hidden="true">
          <circle className="k-ring-track" cx="120" cy="120" r="100" />
        </svg>
        <div className="k-ring-label">
          <svg className="s-icon" viewBox="0 0 24 24" aria-hidden="true">
            {icon.map((d) => (
              <motion.path
                key={d}
                d={d}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={
                  reduced ? { duration: 0 } : { duration: 0.9, delay: 0.35 }
                }
              />
            ))}
          </svg>
        </div>
      </div>
      <div>
        <h1 className="k-finish-title">{title}</h1>
        {children}
      </div>
    </Sheet>
  );
}

/**
 * A sheet that asks for one thing: a big title and a line under it, centred
 * above what the screen adds, such as the join code or a name form.
 */
export function Prompt({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <Sheet className="s-prompt">
      <h1 className="s-display">{title}</h1>
      {lead && <p className="s-lead">{lead}</p>}
      {children}
    </Sheet>
  );
}

/**
 * How the test runs, for a name screen to show above its start button: the
 * minutes each student gets, or the clock time a common end falls at, in the
 * app's language. Nothing for a test without a time limit.
 */
export function StartNotes({ info }: { info: JoinInfo }) {
  let note: string;
  if (info.timeMode === "student") {
    note = m.pick_time_student({
      minutes: info.minutes,
      button: m.pick_start(),
    });
  } else if (info.timeMode === "common") {
    const time = new Date(info.endsAt).toLocaleTimeString(getLocale(), {
      timeStyle: "short",
    });
    note = m.pick_time_common({ time });
  } else return null;
  return <p className="s-notes">{note}</p>;
}

/** A problem the student can fix or report, as a chip with a warning dot. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="s-problem" role="alert">
      <i className="k-dot" />
      {children}
    </p>
  );
}

/** Returns what to tell the student when a join or pick call failed. */
export function errorText(err: unknown): string {
  if (err instanceof NameTaken) return m.pick_name_taken({ label: err.label });
  if (!(err instanceof ApiError)) return m.error_offline();
  if (err.code === "bad_code") return m.join_bad_code();
  if (err.status === 429) return m.error_rate_limited();
  return m.error_server();
}

/** Stroked 24×24 icons for the {@link Notice} screens. */
export const ICONS = {
  back: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  moved: [
    "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    "M8 21h8",
    "M12 17v4",
    "M8 10.5h8",
    "m13 7.5 3 3-3 3",
  ],
  tabs: [
    "M5 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
    "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",
  ],
  network: [
    "M2 8.8a15 15 0 0 1 20 0",
    "M5 12.4a10 10 0 0 1 14 0",
    "M8.5 15.9a5 5 0 0 1 7 0",
    "M12 19.5h.01",
  ],
};
