import type { ExportResult } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { notify } from "./Toasts";

/**
 * Finishes an export. Without the desktop window (`klats -dev`) the file
 * downloads through the browser; in the desktop app a toast names where the
 * save dialog put it; a cancelled dialog (null) shows nothing.
 */
export function finishExport(out: ExportResult | File | null): void {
  if (out instanceof File) {
    const href = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = href;
    a.download = out.name;
    a.click();
    // WebKit reads the URL after click() returns.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    notify(m.results_downloaded({ name: out.name }));
  } else if (out) {
    notify(m.results_saved({ path: out.path }));
  }
}
