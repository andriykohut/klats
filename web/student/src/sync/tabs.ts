/** A lease not refreshed for this long is free to take. */
const STALE_MS = 15_000;
const REFRESH_MS = 5_000;

/** The lease in localStorage: the holder's random id and when it last wrote. */
interface Lease {
  id: string;
  at: number;
}

const read = (name: string): Lease | null =>
  JSON.parse(localStorage.getItem(name) ?? "null");

/**
 * Claims the test for this tab with a lease in localStorage under `name`, so
 * only one tab of the browser sends answers. It returns a function that
 * releases the claim, or null when another claim refreshed the lease within
 * the last 15 s; a second claim in the same document is refused too.
 *
 * The holder refreshes the lease every 5 s and releases it on `pagehide`.
 * Once another tab takes the lease over, which it can after 15 s without a
 * refresh (a crashed tab, or one whose timers the browser throttles), the
 * holder stops refreshing and calls `onLost` once; the caller must then stop
 * sending and stop writing the answer queue.
 */
export function claimTab(
  name: string,
  onLost: () => void,
): (() => void) | null {
  const held = read(name);
  if (held && Date.now() - held.at < STALE_MS) return null;

  const id = crypto.getRandomValues(new Uint32Array(2)).join("-");
  const write = () =>
    localStorage.setItem(name, JSON.stringify({ id, at: Date.now() }));
  const stop = () => {
    clearInterval(timer);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", release);
  };
  // Checked before each refresh too, so a throttled holder whose refresh runs
  // just after a takeover gives the lease up instead of writing over it.
  const refresh = () => {
    const now = read(name);
    if (now && now.id !== id) {
      stop();
      onLost();
    } else write();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === name) refresh();
  };
  const release = () => {
    stop();
    if (read(name)?.id === id) localStorage.removeItem(name);
  };

  write();
  const timer = setInterval(refresh, REFRESH_MS);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pagehide", release);
  return release;
}
