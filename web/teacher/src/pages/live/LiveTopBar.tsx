import type { SittingInfo } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Icon } from "../../ui/icons";
import { EndDialog } from "./EndDialog";

const SCALE_NAMES = {
  points12: m.scale_points12,
  percent: m.scale_percent,
  pass: m.scale_pass,
};

/**
 * The time left until `endsAt` (unix ms) on the teacher's own clock, which
 * is the server's, since the teacher app runs on the server's machine: m:ss,
 * or h:mm:ss from an hour up, ticking every second.
 */
function Remaining({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const secs = String(left % 60).padStart(2, "0");
  const mins = Math.floor(left / 60) % 60;
  const hours = Math.floor(left / 3600);
  return (
    <strong role="timer" aria-label={m.timer_label()}>
      {hours > 0
        ? `${hours}:${String(mins).padStart(2, "0")}:${secs}`
        : `${mins}:${secs}`}
    </strong>
  );
}

/**
 * The live view's own bar: the test, its class, question count, scale and
 * per-student time limit, the end time with the time left when the sitting
 * has a common one, the join code with «Показати на дошці», and «Завершити
 * тест». Once the sitting has ended, the time and the code go and the button
 * opens the results instead. The mark leads back to «Мої тести».
 */
export function LiveTopBar(props: {
  sitting: SittingInfo;
  writing: number;
  onBoard: () => void;
}) {
  const s = props.sitting;
  const about = [
    s.className,
    m.builder_count_questions({ count: s.questionCount }),
    SCALE_NAMES[s.scale as keyof typeof SCALE_NAMES]?.(),
    s.timeMode === "student" && m.live_time_student({ minutes: s.minutes }),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <header className="l-bar">
      <Link to="/" className="t-mark l-home" aria-label={m.nav_tests()}>
        <Icon name="check" />
      </Link>
      <div className="l-title">
        <b>{s.testTitle}</b>
        <span>{about}</span>
      </div>
      {s.ended ? (
        <>
          <span className="l-ended">{m.live_ended()}</span>
          <Link
            to="/assignments/$id"
            params={{ id: s.assignmentId }}
            className="t-btn"
            data-variant="primary"
          >
            {m.live_open_results()}
          </Link>
        </>
      ) : (
        <>
          {s.timeMode === "common" && (
            <div className="l-time">
              <small>
                {m.live_time_until({
                  time: new Intl.DateTimeFormat(getLocale(), {
                    timeStyle: "short",
                  }).format(s.endsAt),
                })}
              </small>
              <Remaining endsAt={s.endsAt} />
            </div>
          )}
          <div className="l-code">
            <small>{m.live_code()}</small>
            <strong>{s.code}</strong>
            <Button className="l-ghost" onPress={props.onBoard}>
              {m.live_show_board()}
            </Button>
          </div>
          <EndDialog writing={props.writing} assignmentId={s.assignmentId} />
        </>
      )}
    </header>
  );
}
