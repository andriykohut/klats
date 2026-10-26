import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { autosave, type SaveState } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A save whose calls resolve or reject only when the test says so. */
function server() {
  const calls: {
    value: string;
    ok: (r: string) => void;
    fail: (e: Error) => void;
  }[] = [];
  const save = (value: string) =>
    new Promise<string>((ok, fail) => calls.push({ value, ok, fail }));
  return { calls, save };
}

function setup() {
  const s = server();
  const states: SaveState[] = [];
  const saved: string[] = [];
  const a = autosave<string, string>({
    save: s.save,
    onSaved: (r) => saved.push(r),
    onState: (st) => states.push(st),
  });
  return { ...s, states, saved, a };
}

test("changes within 400 ms go out as one save of the newest value", async () => {
  const { a, calls, states } = setup();
  a.change("a");
  await vi.advanceTimersByTimeAsync(300);
  a.change("ab");
  await vi.advanceTimersByTimeAsync(399);
  expect(calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls.map((c) => c.value)).toEqual(["ab"]);
  calls[0].ok("r1");
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe("saved");
});

test("a change during a save waits for it, then the newest value goes out", async () => {
  const { a, calls, saved } = setup();
  a.change("1");
  await vi.advanceTimersByTimeAsync(400);
  a.change("2");
  a.change("3");
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toHaveLength(1);
  calls[0].ok("r1");
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.map((c) => c.value)).toEqual(["1", "3"]);
  calls[1].ok("r3");
  await vi.advanceTimersByTimeAsync(0);
  expect(saved).toEqual(["r1", "r3"]);
});

test("a failed save is retried with backoff and never drops the newest value", async () => {
  const { a, calls, states } = setup();
  a.change("1");
  await vi.advanceTimersByTimeAsync(400);
  calls[0].fail(new Error("down"));
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe("retrying");
  await vi.advanceTimersByTimeAsync(999);
  expect(calls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls.map((c) => c.value)).toEqual(["1", "1"]);
  a.change("2");
  calls[1].fail(new Error("down"));
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe("retrying");
  await vi.advanceTimersByTimeAsync(2000);
  expect(calls.at(-1)?.value).toBe("2");
  calls.at(-1)?.ok("r2");
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe("saved");
});

test("flush saves at once and resolves when everything is saved", async () => {
  const { a, calls } = setup();
  a.change("1");
  let done = false;
  const f = a.flush().then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.map((c) => c.value)).toEqual(["1"]);
  expect(done).toBe(false);
  calls[0].ok("r1");
  await f;
  expect(done).toBe(true);
  await expect(a.flush()).resolves.toBeUndefined();
});

test("flush rejects when the save fails", async () => {
  const { a, calls } = setup();
  a.change("1");
  const f = a.flush();
  await vi.advanceTimersByTimeAsync(0);
  calls[0].fail(new Error("down"));
  await expect(f).rejects.toThrow("down");
});

test("stop sends what is pending and retries no more; start retries again", async () => {
  const { a, calls } = setup();
  a.change("1");
  const stopped = a.stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.map((c) => c.value)).toEqual(["1"]);
  calls[0].fail(new Error("down"));
  await expect(stopped).rejects.toThrow("down");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(calls).toHaveLength(1);
  a.start();
  a.change("2");
  await vi.advanceTimersByTimeAsync(400);
  expect(calls.map((c) => c.value)).toEqual(["1", "2"]);
});

/** An error the stubbed server answers with a 400. */
const refusal = () => Object.assign(new Error("400"), { refused: true });

function strict() {
  const s = server();
  const states: SaveState[] = [];
  const a = autosave<string, string>({
    save: s.save,
    onSaved: () => {},
    onState: (st) => states.push(st),
    refused: (err) => (err as { refused?: boolean }).refused === true,
  });
  return { ...s, states, a };
}

test("a refused save is not retried; the next edit tries again", async () => {
  const { a, calls, states } = strict();
  a.change("1");
  await vi.advanceTimersByTimeAsync(400);
  calls[0].fail(refusal());
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe("refused");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toHaveLength(1);
  a.change("2");
  expect(states.at(-1)).toBe("saving");
  await vi.advanceTimersByTimeAsync(400);
  expect(calls.map((c) => c.value)).toEqual(["1", "2"]);
  calls[1].ok("r2");
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)).toBe("saved");
});

test("flush after a refusal sends the refused value again and rejects if it is refused again", async () => {
  const { a, calls } = strict();
  a.change("1");
  await vi.advanceTimersByTimeAsync(400);
  calls[0].fail(refusal());
  await vi.advanceTimersByTimeAsync(0);
  const f = a.flush();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.map((c) => c.value)).toEqual(["1", "1"]);
  calls[1].fail(refusal());
  await expect(f).rejects.toThrow("400");
});

test("an edit made during a refused save goes out at once", async () => {
  const { a, calls, states } = strict();
  a.change("1");
  await vi.advanceTimersByTimeAsync(400);
  a.change("2");
  await vi.advanceTimersByTimeAsync(400);
  expect(calls).toHaveLength(1);
  calls[0].fail(refusal());
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.map((c) => c.value)).toEqual(["1", "2"]);
  expect(states.at(-1)).not.toBe("refused");
});

test("other failures are still retried when a refusal test is given", async () => {
  const { a, calls, states } = strict();
  a.change("1");
  await vi.advanceTimersByTimeAsync(400);
  calls[0].fail(new Error("down"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(states.at(-1)).toBe("retrying");
  expect(calls).toHaveLength(2);
});
