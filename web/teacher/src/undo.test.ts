import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { undoWindow } from "./undo";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("resolves true once the window has passed without an undo", async () => {
  const w = undoWindow(6000);
  let result: boolean | undefined;
  w.done.then((r) => {
    result = r;
  });
  await vi.advanceTimersByTimeAsync(5999);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(result).toBe(true);
});

test("an undo inside the window resolves false at once", async () => {
  const w = undoWindow(6000);
  await vi.advanceTimersByTimeAsync(3000);
  w.undo();
  await expect(w.done).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test("an undo after the window changes nothing", async () => {
  const w = undoWindow(6000);
  await vi.advanceTimersByTimeAsync(6000);
  w.undo();
  await expect(w.done).resolves.toBe(true);
});
