import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { useEffect, useState } from "react";

/**
 * A common end time `endsAt` (unix ms) as «до HH:MM» over the time left: m:ss,
 * or h:mm:ss from an hour up, ticking every second. The time left comes from
 * the teacher's own clock, which is the server's, since the teacher app runs
 * on the server's machine. The caller's wrapper sets the sizes.
 */
export function EndTime({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const secs = String(left % 60).padStart(2, "0");
  const mins = Math.floor(left / 60) % 60;
  const hours = Math.floor(left / 3600);
  const until = new Intl.DateTimeFormat(getLocale(), {
    timeStyle: "short",
  }).format(endsAt);
  return (
    <>
      <small>{m.live_time_until({ time: until })}</small>
      <strong role="timer" aria-label={m.timer_label()}>
        {hours > 0
          ? `${hours}:${String(mins).padStart(2, "0")}:${secs}`
          : `${mins}:${secs}`}
      </strong>
    </>
  );
}
