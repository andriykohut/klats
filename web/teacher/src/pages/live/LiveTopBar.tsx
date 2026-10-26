import type { SittingInfo } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import { Button } from "react-aria-components";
import { Icon } from "../../ui/icons";
import { EndDialog } from "./EndDialog";
import { EndTime } from "./EndTime";

const SCALE_NAMES = {
  points12: m.scale_points12,
  percent: m.scale_percent,
  pass: m.scale_pass,
};

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
              <EndTime endsAt={s.endsAt} />
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
