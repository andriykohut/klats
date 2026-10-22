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
 * Whether the lease was refreshed within the last 15 s. Both ways, so a
 * crashed tab's lease from before the clock was corrected backwards does not
 * lock every tab out until the clock catches up.
 */
const fresh = (lease: Lease | null): lease is Lease =>
  lease !== null && Math.abs(Date.now() - lease.at) < STALE_MS;

/**
 * This document's claims, name to holder id, kept whether or not the lease
 * could be stored.
 */
const claimed = new Map<string, string>();

/**
 * Claims the test for this tab with a lease in localStorage under `name`, so
 * only one tab of the browser sends answers. It returns a function that
 * releases the claim, or null when another claim refreshed the lease within
 * the last 15 s; a second claim in the same document is refused too, even
 * when the lease cannot be stored. A lease stamped more than 15 s in the
 * future counts as stale, and an unreadable one is set aside (see
 * {@link readStored}).
 *
 * The holder refreshes the lease every 5 s and releases it when the page
 * unloads. A page going into the back/forward cache keeps its lease, and
 * checks it again when shown. Once another tab takes the lease over, which it
 * can after 15 s without a refresh (a crashed tab, or one whose timers the
 * browser throttles), the holder stops refreshing and calls `onLost` once;
 * the caller must then stop sending and stop writing the answer queue. Only
 * a fresh lease of another tab counts as a takeover.
 *
 * A lease that cannot be written is logged once per run of failures and
 * never throws: the claim still succeeds, and holds in memory.
 */
export function claimTab(
  name: string,
  onLost: () => void,
): (() => void) | null {
  if (claimed.has(name) || fresh(read(name))) return null;
  const id = crypto.getRandomValues(new Uint32Array(2)).join("-");
  claimed.set(name, id);
  let failing = false;
  // A lease that cannot be written (full storage, a private window) must not
  // keep the student from the test: this tab holds on regardless, and a
  // second sender is harmless, as submits are idempotent by changeId.
  const write = () => {
    try {
      localStorage.setItem(name, JSON.stringify({ id, at: Date.now() }));
      failing = false;
    } catch (err) {
      if (!failing) console.error("The tab lease could not be saved", err);
      failing = true;
    }
  };
  const stop = () => {
    if (claimed.get(name) === id) claimed.delete(name);
    clearInterval(timer);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("pageshow", onShow);
  };
  // Checked before each refresh too, so a throttled holder whose refresh runs
  // just after a takeover gives the lease up instead of writing over it. A
  // stale lease of another tab is no takeover: it is what a crashed tab left
  // behind when this tab's own writes fail.
  const refresh = () => {
    const now = read(name);
    if (fresh(now) && now.id !== id) {
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
