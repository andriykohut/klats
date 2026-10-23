import { m } from "@klats/shared/paraglide/messages.js";
import { Button } from "react-aria-components";

/**
 * Says a page's data did not load, or `text` when given, with a button that
 * loads it again.
 */
export function LoadError({
  onRetry,
  text = m.load_failed(),
}: {
  onRetry: () => void;
  text?: string;
}) {
  return (
    <div className="t-page">
      <div className="t-empty">
        <p>{text}</p>
        <Button className="t-btn" data-variant="quiet" onPress={onRetry}>
          {m.error_retry()}
        </Button>
      </div>
    </div>
  );
}
