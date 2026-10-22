import { readStored } from "./storage";

/** A lease not refreshed for this long is free to take. */
const STALE_MS = 15_000;
const REFRESH_MS = 5_000;

/** The lease in localStorage: the holder's random id and when it last wrote. */
interface Lease {
  id: string;
  at: number;
}

const isLease = (value: unknown): value is Lease => {
  const lease = value as Lease | null;
  return typeof lease?.id === "string" && typeof lease.at === "number";
};

const read = (name: string) => readStored(localStorage, name, isLease);

/**
 * Claims the test for this tab with a lease in localStorage under `name`, so
 * only one tab of the browser sends answers. It returns a function that
 * releases the claim, or null when another claim refreshed the lease within
 * the last 15 s; a second claim in the same document is refused too. A
 * lease stamped more than 15 s in the future counts as stale, and an
 * unreadable one is set aside (see {@link readStored}).
 *
 * The holder refreshes the lease every 5 s and releases it when the page
 * unloads. A page going into the back/forward cache keeps its lease, and
 * checks it again when shown. Once another tab takes the lease over, which it
 * can after 15 s without a refresh (a crashed tab, or one whose timers the
 * browser throttles), the holder stops refreshing and calls `onLost` once;
 * the caller must then stop sending and stop writing the answer queue.
 */
export function claimTab(
  name: string,
  onLost: () => void,
): (() => void) | null {
  const held = read(name);
  // Both ways, so a crashed tab's lease from before the clock was corrected
  // backwards does not lock every tab out until the clock catches up.
  if (held && Math.abs(Date.now() - held.at) < STALE_MS) return null;

  const id = crypto.getRandomValues(new Uint32Array(2)).join("-");
  const write = () =>
    localStorage.setItem(name, JSON.stringify({ id, at: Date.now() }));
  const stop = () => {
    clearInterval(timer);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("pageshow", onShow);
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
  const onHide = (e: PageTransitionEvent) => {
    if (!e.persisted) release();
  };
  // A page restored from the back/forward cache missed the storage events and
  // refreshes of its time there.
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) refresh();
  };

  write();
  const timer = setInterval(refresh, REFRESH_MS);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  return release;
}
