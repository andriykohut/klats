import type { SittingInfo } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import { Button } from "react-aria-components";
import { Icon } from "../../ui/icons";
import { EndDialog } from "./EndDialog";

/**
 * The live view's own bar: the test, its class and question count, the join
 * code with «Показати на дошці», and «Завершити тест». Once the sitting has
 * ended, the code goes and the button opens the results instead. The mark
 * leads back to «Мої тести».
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
          <div className="l-code">
            <small>{m.live_code()}</small>
            <strong>{s.code}</strong>
            <Button className="l-ghost" onPress={props.onBoard}>
              {m.live_show_board()}
            </Button>
          </div>
          {/* shortcut: no time remaining here, as tests in this version have no time limit; show it beside the end button once tests can have one. */}
          <EndDialog writing={props.writing} assignmentId={s.assignmentId} />
        </>
      )}
    </header>
  );
}
