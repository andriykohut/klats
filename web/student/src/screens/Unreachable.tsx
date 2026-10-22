import { m } from "@klats/shared/paraglide/messages.js";
import { ICONS, Notice } from "./ui";

/** The teacher's computer did not answer when the page started. */
export function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice icon={ICONS.network} title={m.error_unreachable()}>
      <div className="s-actions">
        <button type="button" className="s-btn" onClick={onRetry}>
          <span>{m.error_retry()}</span>
        </button>
      </div>
    </Notice>
  );
}
