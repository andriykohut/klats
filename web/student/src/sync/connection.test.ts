import type {
  Status,
  SubmitRequest,
  SubmitResult,
} from "@klats/shared/generated/wire.ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError, Connection, type Transport } from "./connection";
import { memoryStorage } from "./memory-storage";
import { AnswerQueue } from "./queue";

const WRITING: Status = { state: "writing" };
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const ackAll = async (
  _: string,
  req: SubmitRequest,
): Promise<SubmitResult> => ({
  acks: req.changes.map((c) => c.changeId),
  rejected: 0,
  status: WRITING,
});

/** A transport that acks every change and answers heartbeats, logging each call. */
function fakeTransport() {
  const log: string[] = [];
  const submit = vi.fn<Transport["submit"]>(ackAll);
  const heartbeat = vi.fn<Transport["heartbeat"]>(async () => WRITING);
  const transport: Transport = {
    submit: (base, req, signal) => {
      log.push(`submit ${req.changes.length} left ${req.pending}`);
      return submit(base, req, signal);
    },
    heartbeat: (base, req, signal) => {
      log.push(`heartbeat ${req.pending}`);
      return heartbeat(base, req, signal);
    },
  };
  return { transport, submit, heartbeat, log };
}

function setup(storage = memoryStorage()) {
  const t = fakeTransport();
  const queue = new AnswerQueue(storage, "k", "p1");
  const conn = new Connection(t.transport, queue);
  const states: string[] = [];
  conn.onState((state, pending) => states.push(`${state} ${pending}`));
  return { ...t, queue, conn, states };
}

/** Advances the fake clock to `ms` after the test's start, running due timers. */
const until = (ms: number) => vi.advanceTimersByTimeAsync(ms - Date.now());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Silences and returns console.error, which the code logs swallowed errors to. */
const consoleError = () =>
  vi.spyOn(console, "error").mockImplementation(() => {});

test("goes offline after two failed heartbeats and flushes on recovery", async () => {
  const { conn, queue, heartbeat, submit, log, states } = setup();
  heartbeat.mockImplementation(offline);
  conn.start();
  await until(0);
  expect(states).toEqual(["online 0"]);
  await until(5000);
  expect(states).toEqual(["online 0", "offline 0"]);

  queue.set("q1", { items: ["a"] });
  conn.flush();
  expect(states.at(-1)).toBe("offline 1");
  expect(submit).not.toHaveBeenCalled();

  heartbeat.mockResolvedValue(WRITING);
  await until(6000);
  expect(log).toEqual([
    "heartbeat 0",
    "heartbeat 0",
    "submit 1 left 0",
    "heartbeat 0",
  ]);
  expect(states).toEqual(["online 0", "offline 0", "offline 1", "online 0"]);
  expect(queue.pending()).toEqual([]);
});

test("retries after 1, 2, 4, 8 and then every 8 s offline, and beats every 5 s online", async () => {
  const { conn, heartbeat } = setup();
  heartbeat.mockImplementation(offline);
  conn.start();
  const beats = [5000, 6000, 8000, 12000, 20000, 28000];
  for (const [i, at] of beats.entries()) {
    await until(at - 1);
    expect(heartbeat).toHaveBeenCalledTimes(i + 1);
    await until(at);
    expect(heartbeat).toHaveBeenCalledTimes(i + 2);
  }
  heartbeat.mockResolvedValue(WRITING);
  await until(36000);
  expect(heartbeat).toHaveBeenCalledTimes(8);
  await until(40999);
  expect(heartbeat).toHaveBeenCalledTimes(8);
  await until(41000);
  expect(heartbeat).toHaveBeenCalledTimes(9);

  // A second outage starts the backoff over at 1 s.
  heartbeat.mockImplementation(offline);
  await until(51000);
  expect(heartbeat).toHaveBeenCalledTimes(11);
  await until(51999);
  expect(heartbeat).toHaveBeenCalledTimes(11);
  await until(52000);
  expect(heartbeat).toHaveBeenCalledTimes(12);
});

test("chunks submits at 100 changes, each reporting what is left after it", async () => {
  const { conn, queue, log } = setup();
  for (let i = 0; i < 250; i++) queue.set(`q${i}`, { items: ["a"] });
  conn.start();
  await until(0);
  expect(log).toEqual([
    "submit 100 left 150",
    "submit 100 left 50",
    "submit 50 left 0",
    "heartbeat 0",
  ]);
});

test("reports syncing after an outage until the queue drains", async () => {
  const { conn, queue, heartbeat, states } = setup();
  heartbeat.mockImplementation(offline);
  conn.start();
  await until(5000);
  for (let i = 0; i < 150; i++) queue.set(`q${i}`, { items: ["a"] });
  conn.flush();
  heartbeat.mockResolvedValue(WRITING);
  await until(6000);
  expect(states).toEqual([
    "online 0",
    "offline 0",
    "offline 150",
    "syncing 50",
    "online 0",
  ]);
});

test("sends one submit at a time; changes set meanwhile go in the next", async () => {
  const { conn, queue, submit, log } = setup();
  let answer = () => {};
  submit.mockImplementationOnce(
    (_, req) =>
      new Promise((resolve) => {
        answer = () => resolve(ackAll("", req));
      }),
  );
  queue.set("q1", { items: ["a"] });
  conn.start();
  await until(0);
  queue.set("q2", { items: ["b"] });
  conn.flush();
  await until(0);
  expect(log).toEqual(["submit 1 left 0"]);

  answer();
  await until(0);
  expect(log).toEqual(["submit 1 left 0", "submit 1 left 0", "heartbeat 0"]);
  expect(submit.mock.calls[1]?.[1].changes[0]?.questionId).toBe("q2");
  expect(queue.pending()).toEqual([]);
});

test("rejected changes are acked and never resent", async () => {
  const { conn, queue, submit } = setup();
  submit.mockImplementation(async (base, req) => ({
    ...(await ackAll(base, req)),
    rejected: 1,
  }));
  queue.set("q1", { items: ["a"] });
  conn.start();
  await until(60000);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(queue.pending()).toEqual([]);
});

test("HTTP errors keep the changes and back off, but never go offline", async () => {
  const { conn, queue, submit, heartbeat, log, states } = setup();
  // The first cycle's submit and heartbeat are both refused.
  heartbeat.mockRejectedValueOnce(new ApiError(503, "internal"));
  submit
    .mockRejectedValueOnce(new ApiError(503, "internal"))
    .mockRejectedValueOnce(new ApiError(429, "rate_limited"))
    .mockRejectedValueOnce(new ApiError(400, "invalid"))
    .mockRejectedValueOnce(new ApiError(404, "not_found"));
  queue.set("q1", { items: ["a"] });
  conn.start();
  await until(14999);
  expect(submit).toHaveBeenCalledTimes(4);
  expect(queue.pending()).toHaveLength(1);
  // Each refused submit is followed by a heartbeat, which counts the change.
  expect(log.filter((l) => l === "heartbeat 1")).toHaveLength(4);
  await until(15000);
  expect(log.at(-1)).toBe("heartbeat 0");
  expect(states).toEqual(["online 1", "online 0"]);
});

test("statuses reach onStatus with nulls as undefined", async () => {
  const { conn, heartbeat } = setup();
  const statuses: Status[] = [];
  conn.onStatus((s) => statuses.push(s));
  const result = { grade: 9, correct: 7, total: 10 };
  // The server sends absent pointer fields as null.
  heartbeat.mockResolvedValue({
    state: "ended",
    remainingMs: null,
    result,
  } as unknown as Status);
  conn.start();
  await until(0);
  expect(statuses).toEqual([
    { state: "ended", remainingMs: undefined, result },
  ]);
});

test("a request unanswered for 8 s is aborted and counts as a failure", async () => {
  const { conn, heartbeat, states } = setup();
  heartbeat.mockImplementation(() => new Promise(() => {}));
  conn.start();
  await until(0);
  const signal = heartbeat.mock.calls[0]?.[2];
  await until(7999);
  expect(signal?.aborted).toBe(false);
  await until(8000);
  expect(signal?.aborted).toBe(true);
  // The second heartbeat goes 5 s later and also hangs for 8 s.
  await until(20999);
  expect(states).toEqual(["online 0"]);
  await until(21000);
  expect(states).toEqual(["online 0", "offline 0"]);
});

test("drain resolves true once all is acked, false while offline", async () => {
  const { conn, queue, heartbeat } = setup();
  queue.set("q1", { items: ["a"] });
  conn.start();
  await expect(conn.drain()).resolves.toBe(true);

  heartbeat.mockImplementation(offline);
  await until(10000);
  queue.set("q2", { items: ["b"] });
  await expect(conn.drain()).resolves.toBe(false);
});

test("setBase sends to the new address at once", async () => {
  const { conn, heartbeat, states } = setup();
  heartbeat.mockImplementation(offline);
  conn.start();
  await until(5000);
  expect(heartbeat.mock.calls.map((c) => c[0])).toEqual(["", ""]);

  heartbeat.mockResolvedValue(WRITING);
  conn.setBase("http://10.0.0.5:8080");
  await until(5000);
  expect(heartbeat.mock.calls.at(-1)?.[0]).toBe("http://10.0.0.5:8080");
  expect(states.at(-1)).toBe("online 0");
});

test("after stop it sends nothing and leaves the queue alone", async () => {
  const { conn, queue, submit, heartbeat } = setup();
  let answer = () => {};
  submit.mockImplementationOnce(
    (_, req) =>
      new Promise((resolve) => {
        answer = () => resolve(ackAll("", req));
      }),
  );
  queue.set("q1", { items: ["a"] });
  conn.start();
  await until(0);
  const drained = conn.drain();
  conn.stop();
  await expect(drained).resolves.toBe(false);
  answer();
  queue.set("q2", { items: ["b"] });
  conn.flush();
  await until(60000);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(heartbeat).not.toHaveBeenCalled();
  expect(queue.pending()).toHaveLength(2);
});

test("a failure after stop reaches no listener", async () => {
  const { conn, queue, submit, heartbeat, states } = setup();
  heartbeat.mockImplementationOnce(offline);
  let fail = () => {};
  submit.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = () => reject(new TypeError("Failed to fetch"));
      }),
  );
  conn.start();
  await until(0);
  queue.set("q1", { items: ["a"] });
  conn.flush();
  await until(0);
  conn.stop();
  // A second failure would mean offline, had it counted.
  fail();
  await until(0);
  expect(states).toEqual(["online 0", "online 1"]);
});

test("a listener that stops it ends the cycle at once", async () => {
  const { conn, queue, submit, heartbeat } = setup();
  conn.onStatus(() => conn.stop());
  for (let i = 0; i < 150; i++) queue.set(`q${i}`, { items: ["a"] });
  conn.start();
  await until(60000);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(heartbeat).not.toHaveBeenCalled();
});

test("a kicked device reports it once, then sends nothing more", async () => {
  const { conn, queue, submit, heartbeat } = setup();
  const statuses: Status[] = [];
  conn.onStatus((s) => statuses.push(s));
  submit.mockRejectedValue(new ApiError(403, "kicked"));
  queue.set("q1", { items: ["a"] });
  conn.start();
  const drained = conn.drain();
  await until(60000);
  expect(statuses).toEqual([{ state: "kicked" }]);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(heartbeat).not.toHaveBeenCalled();
  await expect(drained).resolves.toBe(false);

  // A heartbeat answers a kicked device with 200 and the kicked status.
  const beat = setup();
  const told = vi.fn();
  beat.conn.onStatus(told);
  beat.heartbeat.mockResolvedValue({ state: "kicked" });
  beat.conn.start();
  await until(120000);
  expect(told).toHaveBeenCalledTimes(1);
  expect(beat.heartbeat).toHaveBeenCalledTimes(1);
});

test("a throwing listener is logged and never stops syncing", async () => {
  const error = consoleError();
  const { conn, queue, submit, heartbeat } = setup();
  conn.onState(() => {
    throw new Error("state listener");
  });
  const statuses = vi.fn().mockImplementationOnce(() => {
    throw new Error("status listener");
  });
  conn.onStatus(statuses);
  conn.start();
  await until(5000);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  expect(statuses).toHaveBeenCalledTimes(2);

  queue.set("q1", { items: ["a"] });
  conn.flush();
  await expect(conn.drain()).resolves.toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalled();
});

test("a storage write failing during ack loses nothing and stops nothing", async () => {
  const error = consoleError();
  const storage = memoryStorage();
  const { conn, queue, heartbeat } = setup(storage);
  queue.set("q1", { items: ["a"] });
  vi.spyOn(storage, "setItem").mockImplementationOnce(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  conn.start();
  await until(5000);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  expect(queue.saveFailed).toBe(true);
  expect(error).toHaveBeenCalledTimes(1);
  expect(queue.current("q1")).toEqual({ items: ["a"] });

  // The next write saves the whole state again.
  queue.set("q2", { items: ["b"] });
  expect(queue.saveFailed).toBe(false);
  const reloaded = new AnswerQueue(storage, "k", "p1");
  expect(reloaded.current("q1")).toEqual({ items: ["a"] });
  expect(reloaded.pending().map((c) => c.questionId)).toEqual(["q2"]);
});

test("a refused submit lets the heartbeat through; a failed one skips it", async () => {
  const { conn, queue, submit, log } = setup();
  submit
    .mockImplementationOnce(offline)
    .mockRejectedValueOnce(new ApiError(500, "internal"));
  queue.set("q1", { items: ["a"] });
  conn.start();
  await until(0);
  expect(log).toEqual(["submit 1 left 0"]);
  await until(5000);
  expect(log.slice(1)).toEqual(["submit 1 left 0", "heartbeat 1"]);
  await until(6000);
  expect(log.slice(3)).toEqual(["submit 1 left 0", "heartbeat 0"]);
});

test("an empty flush or drain does not put the heartbeat off", async () => {
  const { conn, heartbeat } = setup();
  conn.start();
  for (let at = 4000; at <= 20000; at += 4000) {
    await until(at);
    conn.flush();
    await conn.drain();
  }
  expect(heartbeat).toHaveBeenCalledTimes(5);
});

test("setBase gives up a request to the old address at once, not as a failure", async () => {
  const { conn, heartbeat, states } = setup();
  heartbeat
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockImplementationOnce(offline);
  conn.start();
  await until(1000);
  conn.setBase("http://10.0.0.5:8080");
  await until(1000);
  expect(heartbeat.mock.calls.map((c) => c[0])).toEqual([
    "",
    "http://10.0.0.5:8080",
  ]);
  expect(heartbeat.mock.calls[0]?.[2].aborted).toBe(true);
  // One failure, at the new address: still online.
  expect(states).toEqual(["online 0"]);
});

test("an error thrown inside a cycle is logged and the next cycle still runs", async () => {
  const error = consoleError();
  const { conn, queue, submit } = setup();
  queue.set("q1", { items: ["a"] });
  vi.spyOn(queue, "ack").mockImplementationOnce(() => {
    throw new Error("broken");
  });
  conn.start();
  await until(0);
  expect(error).toHaveBeenCalledTimes(1);
  await until(1000);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(queue.pending()).toEqual([]);
});

test("refused submits while the student keeps answering never hold the heartbeat back", async () => {
  const { conn, queue, submit, heartbeat } = setup();
  submit.mockRejectedValue(new ApiError(500, "internal"));
  const beats: number[] = [];
  heartbeat.mockImplementation(async () => {
    beats.push(Date.now());
    return WRITING;
  });
  conn.start();
  for (let at = 0; at <= 60_000; at += 4000) {
    await until(at);
    queue.set(`q${at}`, { items: ["a"] });
    conn.flush();
  }
  const gaps = beats.slice(1).map((t, i) => t - (beats[i] ?? 0));
  expect(beats.length).toBeGreaterThan(7);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(8000);
});

test("one network blip never shows offline; two failed cycles do", async () => {
  const { conn, queue, submit, heartbeat, states } = setup();
  let down = [5000, 5050];
  const isDown = () => Date.now() >= down[0] && Date.now() < down[1];
  submit.mockImplementation((base, req) =>
    isDown() ? offline() : ackAll(base, req),
  );
  heartbeat.mockImplementation(() =>
    isDown() ? offline() : Promise.resolve(WRITING),
  );
  conn.start();
  // Set without a flush, so the change goes with the 5 s cycle.
  await until(4999);
  queue.set("q1", { items: ["a"] });
  await until(20000);
  expect(states.filter((s) => s.startsWith("offline"))).toEqual([]);

  down = [25000, 31000];
  await until(24999);
  queue.set("q2", { items: ["b"] });
  await until(29999);
  expect(states.filter((s) => s.startsWith("offline"))).toEqual([]);
  await until(30000);
  expect(states.at(-1)).toBe("offline 1");
});

test("setBase during an offline retry adds no backoff step", async () => {
  const { conn, heartbeat } = setup();
  heartbeat.mockImplementation(offline);
  conn.start();
  await until(5000);
  heartbeat.mockImplementationOnce(() => new Promise(() => {}));
  await until(6500);
  conn.setBase("http://10.0.0.5:8080");
  await until(6500);
  expect(heartbeat).toHaveBeenCalledTimes(4);
  // The failure at the new base is the second offline retry: 2 s, not 4 s.
  await until(8499);
  expect(heartbeat).toHaveBeenCalledTimes(4);
  await until(8500);
  expect(heartbeat).toHaveBeenCalledTimes(5);
});

test("setBase during a submit starts a fresh cycle, with no heartbeat in between", async () => {
  const { conn, queue, submit, log } = setup();
  submit.mockImplementationOnce(() => new Promise(() => {}));
  queue.set("q1", { items: ["a"] });
  conn.start();
  await until(1000);
  conn.setBase("http://10.0.0.5:8080");
  await until(1000);
  expect(log).toEqual(["submit 1 left 0", "submit 1 left 0", "heartbeat 0"]);
});

test("a submit that fails between cycles does not put the next cycle off", async () => {
  const { conn, queue, submit, heartbeat } = setup();
  submit.mockImplementationOnce(offline);
  conn.start();
  await until(4000);
  queue.set("q1", { items: ["a"] });
  conn.flush();
  await until(5000);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(heartbeat).toHaveBeenCalledTimes(2);
});

test("heartbeatNow beats at once, never beside another request, and resets the 5 s wait", async () => {
  const { conn, heartbeat } = setup();
  conn.start();
  await until(1000);
  conn.heartbeatNow();
  await until(1000);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  await until(5999);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  await until(6000);
  expect(heartbeat).toHaveBeenCalledTimes(3);

  let answer: (s: Status) => void = () => {};
  heartbeat.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await until(11000);
  conn.heartbeatNow();
  conn.heartbeatNow();
  await until(11500);
  expect(heartbeat).toHaveBeenCalledTimes(4);
  answer(WRITING);
  await until(11500);
  expect(heartbeat).toHaveBeenCalledTimes(5);

  conn.stop();
  conn.heartbeatNow();
  await until(30000);
  expect(heartbeat).toHaveBeenCalledTimes(5);
});
