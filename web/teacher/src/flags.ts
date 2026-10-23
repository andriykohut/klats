import { useSyncExternalStore } from "react";

/**
 * App-wide states that no API query holds: `unauthorized` once the server
 * refused the launch-token cookie; `addressChanged` once the students' URL
 * changed, until the teacher dismisses the banner; `portSaved` once the
 * teacher saved a port in this session; `focusPort` from a press on the
 * port-busy banner's link until the port field takes focus.
 */
export interface Flags {
  unauthorized: boolean;
  addressChanged: boolean;
  portSaved: boolean;
  focusPort: boolean;
}

let flags: Flags = {
  unauthorized: false,
  addressChanged: false,
  portSaved: false,
  focusPort: false,
};
const listeners = new Set<() => void>();

export function setFlags(patch: Partial<Flags>): void {
  flags = { ...flags, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFlags(): Flags {
  return useSyncExternalStore(subscribe, () => flags);
}
