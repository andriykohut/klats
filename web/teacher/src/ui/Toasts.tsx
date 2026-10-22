import { m } from "@klats/shared/paraglide/messages.js";
import {
  Button,
  Text,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from "react-aria-components";
import { Icon } from "./icons";

/** A toast's text, an optional button beside it, and whether it reports a failure. */
export interface ToastItem {
  text: string;
  action?: { label: string; onAction: () => void };
  error?: boolean;
}

/** The app's one toast queue; three toasts show at once, newest at the bottom. */
export const toasts = new ToastQueue<ToastItem>({ maxVisibleToasts: 3 });

/** Shows `text` for 5 s, the shortest time React Aria recommends. */
export function notify(text: string, error = false): void {
  toasts.add({ text, error }, { timeout: 5000 });
}

export function Toasts() {
  return (
    <ToastRegion queue={toasts} className="t-toasts">
      {({ toast }) => (
        <Toast
          toast={toast}
          className="t-toast"
          data-error={toast.content.error || undefined}
        >
          <ToastContent className="t-toast-text">
            <Text slot="title">{toast.content.text}</Text>
          </ToastContent>
          {toast.content.action && (
            <Button
              className="t-toast-action"
              onPress={toast.content.action.onAction}
            >
              {toast.content.action.label}
            </Button>
          )}
          <Button
            slot="close"
            className="t-toast-close"
            aria-label={m.action_close()}
          >
            <Icon name="close" />
          </Button>
        </Toast>
      )}
    </ToastRegion>
  );
}
