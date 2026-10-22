import { useSyncExternalStore } from "react";

/**
 * App-wide states that no API query holds: `unauthorized` once the server
 * refused the launch-token cookie, and `addressChanged` once the server
 * reported new LAN addresses, until the teacher dismisses the banner.
 */
export interface Flags {
  unauthorized: boolean;
  addressChanged: boolean;
}

let flags: Flags = { unauthorized: false, addressChanged: false };
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
