import { m } from "@klats/shared/paraglide/messages.js";
import { ICONS, Notice } from "./ui";

/** The teacher sent the student back to the name list. */
export function Kicked({ onPick }: { onPick: () => void }) {
  return (
    <Notice icon={ICONS.back} title={m.kicked_title()}>
      <p className="s-lead">{m.kicked_text()}</p>
      <div className="s-actions">
        <button type="button" className="s-btn" onClick={onPick}>
          <span>{m.kicked_button()}</span>
        </button>
      </div>
    </Notice>
  );
}

/**
 * The teacher moved the student's test to another computer. It says the
 * answers are saved only once `saved`, when the server holds them all.
 */
export function Moved({ saved }: { saved: boolean }) {
  return (
    <Notice icon={ICONS.moved} title={m.moved_title()}>
      {saved && <p className="s-lead">{m.moved_text()}</p>}
    </Notice>
  );
}
