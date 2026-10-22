import type { FinishResult, Status } from "@klats/shared/generated/wire.ts";

/** What the app does about a status the server reported for this device. */
export type Step =
  | { to: "stay" }
  | { to: "resume" }
  | { to: "finish"; result: FinishResult | undefined }
  | { to: "kicked" }
  | { to: "moved" }
  | { to: "names" }
  | { to: "join" };

/**
 * Returns where the status `st` takes the app from the screen named `at`;
 * `syncing` is whether a Connection runs for this device.
 *
 * - writing: load the test, unless it already syncs;
 * - finished, ended: the finish screen, with the result once the server has
 *   one;
 * - kicked: the kicked screen; moved: the moved screen, once;
 * - unjoined: refetch the class list on the name list, stay on the code and
 *   typed-name screens, and go to the code from anywhere else.
 *
 * A tab that lost the test to another tab stays put whatever the status.
 */
export function route(st: Status, at: string, syncing: boolean): Step {
  if (at === "otherTab") return { to: "stay" };
  switch (st.state) {
    case "writing":
      return syncing ? { to: "stay" } : { to: "resume" };
    case "finished":
    case "ended":
      return { to: "finish", result: st.result };
    case "kicked":
      return { to: "kicked" };
    case "moved":
      return at === "moved" ? { to: "stay" } : { to: "moved" };
    default:
      if (at === "pick") return { to: "names" };
      return at === "join" || at === "typed" ? { to: "stay" } : { to: "join" };
  }
}
