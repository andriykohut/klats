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

function setup() {
  const t = fakeTransport();
  const queue = new AnswerQueue(memoryStorage(), "k", "p1");
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
});

test("goes offline after two failed heartbeats and flushes on recovery", async () => {
  const { conn, queue, heartbeat, submit, log, states } = setup();
  heartbeat.mockImplementation(offline);
  conn.start();
  await until(0);
  expect(states).toEqual(["online 0"]);
  await until(5000);
  expect(states).toEqual(["online 0", "offline 0"]);

  queue.set("q1", ["a"]);
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
});

test("chunks submits at 100 changes, each reporting what is left after it", async () => {
  const { conn, queue, log } = setup();
  for (let i = 0; i < 250; i++) queue.set(`q${i}`, ["a"]);
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
  for (let i = 0; i < 150; i++) queue.set(`q${i}`, ["a"]);
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
  queue.set("q1", ["a"]);
  conn.start();
  await until(0);
  queue.set("q2", ["b"]);
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
  queue.set("q1", ["a"]);
  conn.start();
  await until(60000);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(queue.pending()).toEqual([]);
});

test("HTTP errors keep the changes and back off, but never go offline", async () => {
  const { conn, queue, submit, log, states } = setup();
  submit
    .mockRejectedValueOnce(new ApiError(503, "internal"))
    .mockRejectedValueOnce(new ApiError(429, "rate_limited"))
    .mockRejectedValueOnce(new ApiError(400, "invalid"))
    .mockRejectedValueOnce(new ApiError(404, "not_found"));
  queue.set("q1", ["a"]);
  conn.start();
  await until(14999);
  expect(submit).toHaveBeenCalledTimes(4);
  expect(queue.pending()).toHaveLength(1);
  await until(15000);
  expect(log.at(-1)).toBe("heartbeat 0");
  expect(states).toEqual(["online 1", "online 0"]);
});

test("statuses reach onStatus, nulls as undefined, and a kicked 403 as kicked", async () => {
  const { conn, queue, submit, heartbeat } = setup();
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

  submit.mockRejectedValue(new ApiError(403, "kicked"));
  queue.set("q1", ["a"]);
  conn.flush();
  await until(0);
  expect(statuses.at(-1)).toEqual({ state: "kicked" });
  expect(queue.pending()).toHaveLength(1);
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
  queue.set("q1", ["a"]);
  conn.start();
  await expect(conn.drain()).resolves.toBe(true);

  heartbeat.mockImplementation(offline);
  await until(10000);
  queue.set("q2", ["b"]);
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
  queue.set("q1", ["a"]);
  conn.start();
  await until(0);
  conn.stop();
  answer();
  queue.set("q2", ["b"]);
  conn.flush();
  await until(60000);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(heartbeat).not.toHaveBeenCalled();
  expect(queue.pending()).toHaveLength(2);
});

test("a listener that stops it ends the cycle at once", async () => {
  const { conn, queue, submit, heartbeat } = setup();
  conn.onStatus(() => conn.stop());
  for (let i = 0; i < 150; i++) queue.set(`q${i}`, ["a"]);
  conn.start();
  await until(60000);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(heartbeat).not.toHaveBeenCalled();
});
