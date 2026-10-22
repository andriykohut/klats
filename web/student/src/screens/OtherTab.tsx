import { m } from "@klats/shared/paraglide/messages.js";
import { ICONS, Notice } from "./ui";

/** Another tab of this browser holds the test, so this one stays idle. */
export function OtherTab() {
  return (
    <Notice icon={ICONS.tabs} title={m.other_tab_title()}>
      <p className="s-lead">{m.other_tab_text()}</p>
    </Notice>
  );
}
