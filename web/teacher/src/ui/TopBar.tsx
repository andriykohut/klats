import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import { useLive } from "../api/queries";
import { Icon } from "./icons";

/**
 * The teal bar over every page: the brand, the four sections, and, while a
 * sitting runs, a chip with its test and join code that opens the live view.
 */
export function TopBar() {
  const { data: live } = useLive();
  const sitting = live && !live.sitting.ended ? live.sitting : null;
  return (
    <header className="t-bar">
      <Link to="/" className="t-brand">
        <span className="t-mark">
          <Icon name="check" />
        </span>
        {m.app_name()}
      </Link>
      <nav className="t-nav" aria-label={m.nav_label()}>
        <Link to="/" activeOptions={{ exact: true }}>
          {m.nav_tests()}
        </Link>
        <Link to="/classes">{m.nav_classes()}</Link>
        <Link to="/assignments">{m.nav_results()}</Link>
        <Link to="/settings">{m.nav_settings()}</Link>
      </nav>
      {sitting && (
        <Link to="/live" className="t-live-chip">
          <span className="t-live-dot" aria-hidden="true" />
          <span className="t-live-text">
            <small>{m.live_chip_running()}</small>
            <b>{sitting.testTitle}</b>
          </span>
          <span className="t-live-code">
            <small>{m.live_chip_code()}</small>
            <strong>{sitting.code}</strong>
          </span>
        </Link>
      )}
    </header>
  );
}
