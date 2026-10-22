import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryStorage } from "./memory-storage";
import { claimTab } from "./tabs";

const noop = () => {};

/** What another tab's write to `key` delivers to this one. */
const storageEvent = (key: string) =>
  Object.assign(new Event("storage"), { key });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("second tab is refused", () => {
  expect(claimTab("k", noop)).not.toBeNull();
  expect(claimTab("k", noop)).toBeNull();
  // The holder keeps its lease fresh.
  vi.advanceTimersByTime(60_000);
  expect(claimTab("k", noop)).toBeNull();
  expect(claimTab("other", noop)).not.toBeNull();
});

test("release, or leaving the page, frees the claim at once", () => {
  const release = claimTab("k", noop);
  release?.();
  expect(claimTab("k", noop)).not.toBeNull();

  claimTab("p", noop);
  window.dispatchEvent(new Event("pagehide"));
  expect(claimTab("p", noop)).not.toBeNull();
});

test("a lease left stale for 15 s is taken over, and its holder told once", () => {
  const lost = vi.fn();
  claimTab("k", lost);
  // The holder's refresh stops, as in a crashed or throttled tab.
  vi.clearAllTimers();
  vi.advanceTimersByTime(14_999);
  expect(claimTab("k", noop)).toBeNull();
  vi.advanceTimersByTime(1);
  expect(claimTab("k", noop)).not.toBeNull();

  window.dispatchEvent(storageEvent("k"));
  window.dispatchEvent(storageEvent("k"));
  expect(lost).toHaveBeenCalledTimes(1);
});

test("a holder told of a takeover stops refreshing", () => {
  const lost = vi.fn();
  claimTab("k", lost);
  window.dispatchEvent(storageEvent("other"));
  expect(lost).not.toHaveBeenCalled();

  const taken = JSON.stringify({ id: "other-tab", at: Date.now() });
  localStorage.setItem("k", taken);
  window.dispatchEvent(storageEvent("k"));
  expect(lost).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(10_000);
  expect(localStorage.getItem("k")).toBe(taken);
  expect(lost).toHaveBeenCalledTimes(1);
});
