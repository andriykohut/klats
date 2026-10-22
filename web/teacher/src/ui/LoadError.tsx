import { m } from "@klats/shared/paraglide/messages.js";
import { Button } from "react-aria-components";

/** Says a page's data did not load, with a button that loads it again. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="t-page">
      <div className="t-empty">
        <p>{m.load_failed()}</p>
        <Button className="t-btn" data-variant="quiet" onPress={onRetry}>
          {m.error_retry()}
        </Button>
      </div>
    </div>
  );
}
