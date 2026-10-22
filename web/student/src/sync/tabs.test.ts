import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryStorage } from "./memory-storage";
import { claimTab } from "./tabs";

const noop = () => {};

/** What another tab's write to `key` delivers to this one. */
const storageEvent = (key: string) =>
  Object.assign(new Event("storage"), { key });

/** A pagehide or pageshow event; `persisted` means the back/forward cache. */
const pageEvent = (type: string, persisted: boolean) =>
  Object.assign(new Event(type), { persisted });

const otherTab = (at = Date.now()) => JSON.stringify({ id: "other-tab", at });

/** The time of the lease stored under `key`. */
const leaseTime = (key: string): number =>
  JSON.parse(localStorage.getItem(key) ?? "null")?.at;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  // Unloading releases this document's claims, which outlive a test.
  window.dispatchEvent(pageEvent("pagehide", false));
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("second tab is refused", () => {
  expect(claimTab("k", noop)).not.toBeNull();
  expect(claimTab("k", noop)).toBeNull();
  expect(claimTab("other", noop)).not.toBeNull();
  // The holder keeps its lease fresh for the other tabs.
  vi.advanceTimersByTime(60_000);
  expect(Date.now() - leaseTime("k")).toBeLessThan(5_000);
});

test("release, or leaving the page, frees the claim at once", () => {
  const release = claimTab("k", noop);
  release?.();
  expect(claimTab("k", noop)).not.toBeNull();

  claimTab("p", noop);
  window.dispatchEvent(pageEvent("pagehide", false));
  expect(claimTab("p", noop)).not.toBeNull();
});

test("another tab's lease left stale for 15 s is taken over", () => {
  // Another tab claimed and then stopped refreshing, as a crashed or
  // throttled tab does.
  localStorage.setItem("k", otherTab());
  vi.advanceTimersByTime(14_999);
  expect(claimTab("k", noop)).toBeNull();
  vi.advanceTimersByTime(1);
  expect(claimTab("k", noop)).not.toBeNull();
});

test("a holder told of a takeover stops refreshing", () => {
  const lost = vi.fn();
  claimTab("k", lost);
  window.dispatchEvent(storageEvent("other"));
  expect(lost).not.toHaveBeenCalled();

  const taken = otherTab();
  localStorage.setItem("k", taken);
  window.dispatchEvent(storageEvent("k"));
  window.dispatchEvent(storageEvent("k"));
  expect(lost).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(10_000);
  expect(localStorage.getItem("k")).toBe(taken);
  expect(lost).toHaveBeenCalledTimes(1);
});

test("release leaves another tab's lease alone", () => {
  const release = claimTab("k", noop);
  const taken = otherTab();
  localStorage.setItem("k", taken);
  release?.();
  expect(localStorage.getItem("k")).toBe(taken);
});

test("the back/forward cache keeps the claim, and a takeover meanwhile is noticed on return", () => {
  const lost = vi.fn();
  claimTab("k", lost);
  window.dispatchEvent(pageEvent("pagehide", true));
  expect(claimTab("k", noop)).toBeNull();

  // While the page is cached, its timers stop and another tab takes over.
  localStorage.setItem("k", otherTab());
  window.dispatchEvent(pageEvent("pageshow", true));
  expect(lost).toHaveBeenCalledTimes(1);
});

test("a lease stamped in the future counts as stale", () => {
  const ahead = (ms: number) =>
    JSON.stringify({ id: "other-tab", at: Date.now() + ms });
  localStorage.setItem("k", ahead(10_000));
  expect(claimTab("k", noop)).toBeNull();
  localStorage.setItem("k", ahead(3_600_000));
  expect(claimTab("k", noop)).not.toBeNull();
});

test("an unreadable lease is set aside and the claim goes ahead", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.setItem("k", "{oops");
  expect(claimTab("k", noop)).not.toBeNull();
  expect(localStorage.getItem("k.bad")).toBe("{oops");
  expect(error).toHaveBeenCalledTimes(1);
});

test("a lease that cannot be written still claims, and the refresh carries on", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  expect(claimTab("k", noop)).not.toBeNull();
  expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
  expect(setItem).toHaveBeenCalledTimes(5);
  expect(error).toHaveBeenCalledTimes(1);

  setItem.mockRestore();
  vi.advanceTimersByTime(5_000);
  expect(localStorage.getItem("k")).not.toBeNull();
});

const storageFull = () =>
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });

test("with storage full, a crashed tab's stale lease never takes the claim away", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.setItem("k", otherTab(Date.now() - 60_000));
  storageFull();
  const lost = vi.fn();
  expect(claimTab("k", lost)).not.toBeNull();
  vi.advanceTimersByTime(60_000);
  expect(lost).not.toHaveBeenCalled();

  // A reload claims again.
  window.dispatchEvent(pageEvent("pagehide", false));
  expect(claimTab("k", noop)).not.toBeNull();
});

test("with storage full, a second claim in the same document is still refused", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  storageFull();
  const release = claimTab("k", noop);
  expect(release).not.toBeNull();
  expect(claimTab("k", noop)).toBeNull();
  release?.();
  expect(claimTab("k", noop)).not.toBeNull();
  // Releasing the old claim again leaves the new one alone.
  release?.();
  expect(claimTab("k", noop)).toBeNull();
});
