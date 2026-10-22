import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import { toast } from "./motion";
import "./student-ui.css";

export interface ConnectionToastProps {
  state: "online" | "offline" | "syncing";
  /** Answers saved on this computer that the server has not acknowledged. */
  pending: number;
}

/** How long «Зв’язок відновлено» stays up after the connection returns. */
const RESTORED_MS = 2200;

/**
 * A dark toast above the sheet while the connection is down or answers are
 * syncing, reassuring the student that their answers are kept and will be
 * sent. When the state returns to online it says so briefly, then hides.
 * Changes are announced politely to screen readers.
 */
export function ConnectionToast({ state, pending }: ConnectionToastProps) {
  const [restored, setRestored] = useState(false);
  const last = useRef(state);

  useEffect(() => {
    const was = last.current;
    last.current = state;
    if (state !== "online" || was === "online") return;
    setRestored(true);
    const t = setTimeout(() => setRestored(false), RESTORED_MS);
    return () => clearTimeout(t);
  }, [state]);

  let title: string;
  let detail: string | undefined;
  if (state === "offline") {
    title = m.toast_offline();
    detail =
      pending > 0
        ? m.toast_offline_pending({ count: pending })
        : m.toast_offline_none();
  } else if (state === "syncing") {
    title = m.toast_syncing();
    detail =
      pending > 0 ? m.toast_syncing_pending({ count: pending }) : undefined;
  } else {
    title = m.toast_online();
    detail = pending === 0 ? m.toast_all_sent() : undefined;
  }

  return (
    <div className="k-toast-slot" role="status">
      <AnimatePresence>
        {(state !== "online" || restored) && (
          <motion.div className="k-toast" {...toast}>
            <i className={state === "online" ? "k-dot k-dot-ok" : "k-dot"} />
            <span>
              <span className="k-toast-title">{title}</span>
              {detail && <span className="k-toast-detail">{detail}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
