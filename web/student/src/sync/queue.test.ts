import type { StoredAnswer } from "@klats/shared/generated/wire.ts";
import { afterEach, expect, test, vi } from "vitest";
import { memoryStorage } from "./memory-storage";
import { AnswerQueue } from "./queue";

const KEY = "klats.answers.p1";

afterEach(() => {
  vi.restoreAllMocks();
});

test("seq increments per question and survives reload", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  expect(queue.set("q1", { items: ["a"] }).seq).toBe(1);
  expect(queue.set("q1", { items: ["b"] }).seq).toBe(2);
  expect(queue.set("q2", { items: ["c"] }).seq).toBe(1);

  const reloaded = new AnswerQueue(storage, KEY, "p1");
  expect(reloaded.current("q1")).toEqual({ items: ["b"] });
  expect(reloaded.set("q1", { items: ["a"] }).seq).toBe(3);
});

test("a change carries the participant and a 16-byte hex change id", () => {
  const queue = new AnswerQueue(memoryStorage(), KEY, "p1");
  const change = queue.set("q1", { items: ["a", "b"] });
  expect(change).toMatchObject({
    participantId: "p1",
    questionId: "q1",
    answer: { items: ["a", "b"] },
    seq: 1,
  });
  expect(change.changeId).toMatch(/^[0-9a-f]{32}$/);
  expect(queue.set("q1", { items: [] }).changeId).not.toBe(change.changeId);
});

test("only the newest unsent change of a question is kept", () => {
  const queue = new AnswerQueue(memoryStorage(), KEY, "p1");
  queue.set("q1", { items: ["a"] });
  const q2 = queue.set("q2", { items: ["c"] });
  const q1 = queue.set("q1", { items: ["b"] });
  expect(queue.pending()).toEqual([q2, q1]);
});

test("ack removes only acknowledged changes", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  const a = queue.set("q1", { items: ["a"] });
  const b = queue.set("q2", { items: ["b"] });
  queue.ack([a.changeId, "unknown"]);
  expect(queue.pending()).toEqual([b]);
  expect(queue.current("q1")).toEqual({ items: ["a"] });
  expect(new AnswerQueue(storage, KEY, "p1").pending()).toEqual([b]);
});

test("restore keeps newer local answer", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  for (const items of [["a"], ["b"], ["c"], ["d"]]) {
    queue.set("q1", { items });
  }
  const local = queue.set("q3", { items: ["x"] });
  queue.ack([local.changeId]);
  queue.set("q4", { items: ["y"] });

  queue.restore(
    [
      { questionId: "q1", answer: { items: ["z"] }, seq: 2 },
      { questionId: "q2", answer: { items: ["s"] }, seq: 3 },
      { questionId: "q3", answer: { items: ["t"] }, seq: 1 },
      { questionId: "q4", answer: { items: ["u"] }, seq: 5 },
    ],
    0,
  );

  // q1: local seq 4 beats the server's 2 and stays pending.
  expect(queue.current("q1")).toEqual({ items: ["d"] });
  expect(queue.pending().map((c) => [c.questionId, c.seq])).toEqual([
    ["q1", 4],
  ]);
  // q2 and q4: the server's answer wins and the unsent local change is dropped.
  // q3: an equal seq adopts the server's answer.
  expect(queue.current("q2")).toEqual({ items: ["s"] });
  expect(queue.current("q3")).toEqual({ items: ["t"] });
  expect(queue.current("q4")).toEqual({ items: ["u"] });

  const reloaded = new AnswerQueue(storage, KEY, "p1");
  expect(reloaded.current("q4")).toEqual({ items: ["u"] });
  expect(reloaded.set("q1", { items: [] }).seq).toBe(5);
  expect(reloaded.set("q2", { items: [] }).seq).toBe(4);
  expect(reloaded.set("q4", { items: [] }).seq).toBe(6);
});

test("every change after a restore exceeds the seq base, across reloads", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  queue.restore(
    [{ questionId: "q1", answer: { items: ["a"] }, seq: 2 }],
    3_000_000,
  );
  expect(queue.current("q1")).toEqual({ items: ["a"] });
  expect(queue.set("q1", { items: ["b"] }).seq).toBe(3_000_001);
  expect(queue.set("q2", { items: ["c"] }).seq).toBe(3_000_001);
  // A server seq above the base still counts.
  queue.restore(
    [{ questionId: "q3", answer: { items: ["d"] }, seq: 3_000_007 }],
    3_000_000,
  );
  expect(queue.set("q3", { items: ["e"] }).seq).toBe(3_000_008);
  expect(new AnswerQueue(storage, KEY, "p1").set("q4", { items: [] }).seq).toBe(
    3_000_001,
  );
});

/** One participant's answers on the server, which stores a change only when its seq is higher. */
function fakeServer() {
  const rows = new Map<string, StoredAnswer>();
  return {
    /** Delivers and acks everything the queue holds. */
    deliver(queue: AnswerQueue) {
      const changes = queue.pending();
      for (const { questionId, answer, seq } of changes) {
        const held = rows.get(questionId);
        if (!held || seq > held.seq) {
          rows.set(questionId, { questionId, answer, seq });
        }
      }
      queue.ack(changes.map((c) => c.changeId));
    },
    answers: () => [...rows.values()],
    held: (questionId: string) => rows.get(questionId)?.answer,
  };
}

test("after a move the new device outranks the old one's leftovers, which fill the rest", () => {
  const server = fakeServer();
  // Device A, before any move: q3 reaches the server at seq 7, then A goes
  // offline and changes q2 three times, q3 twice and q4 once.
  const a = new AnswerQueue(memoryStorage(), KEY, "p1");
  a.restore(server.answers(), 0);
  for (let i = 1; i <= 7; i++) a.set("q3", { items: [`s${i}`] });
  server.deliver(a);
  for (const items of [["x"], ["y"], ["A-q2"]]) {
    a.set("q2", { items });
  }
  a.set("q3", { items: ["a1"] });
  a.set("q3", { items: ["A-q3"] });
  a.set("q4", { items: ["A-q4"] });

  // The teacher moves the student to device B, which answers q2 and q3 once.
  const bStorage = memoryStorage();
  const b = new AnswerQueue(bStorage, KEY, "p1");
  b.restore(server.answers(), 1_000_000);
  b.set("q2", { items: ["B-q2"] });
  b.set("q3", { items: ["B-q3"] });
  server.deliver(b);

  // A comes back and drains.
  server.deliver(a);
  expect(server.held("q2")).toEqual({ items: ["B-q2"] });
  expect(server.held("q3")).toEqual({ items: ["B-q3"] });
  expect(server.held("q4")).toEqual({ items: ["A-q4"] });

  // B reloads and restores with the same base: no second jump.
  const reloaded = new AnswerQueue(bStorage, KEY, "p1");
  reloaded.restore(server.answers(), 1_000_000);
  expect(reloaded.current("q4")).toEqual({ items: ["A-q4"] });
  expect(reloaded.set("q2", { items: ["B2"] }).seq).toBe(1_000_002);
  expect(reloaded.set("q5", { items: ["new"] }).seq).toBe(1_000_001);
});

test("a failed write keeps the answers in memory and is retried on the next", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  queue.set("q1", { items: ["a"] });
  queue.set("q2", { items: ["b"] });
  expect(queue.saveFailed).toBe(true);
  expect(error).toHaveBeenCalledTimes(1);
  expect(queue.pending()).toHaveLength(2);

  setItem.mockRestore();
  queue.set("q3", { items: ["c"] });
  expect(queue.saveFailed).toBe(false);
  expect(new AnswerQueue(storage, KEY, "p1").pending()).toHaveLength(3);
});

const saved = (answers: unknown[], pending: unknown[], v = 2) =>
  JSON.stringify({ v, seqBase: 0, answers, pending });

test.each([
  "{not json",
  "{}",
  saved([], [], 3),
  saved([null], []),
  saved([], [null]),
  saved([{ questionId: "q1", answer: { items: [1] }, seq: 1 }], []),
  saved([{ questionId: "q1", answer: { point: { x: "0" } }, seq: 1 }], []),
  saved([{ questionId: "q1", optionIds: ["a"], seq: 1 }], []),
  saved([{ questionId: "q1", optionIds: [1], seq: 1 }], [], 1),
])(
  "unreadable stored state %s is set aside and the queue starts empty",
  (raw) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem(KEY, raw);
    const queue = new AnswerQueue(storage, KEY, "p1");
    expect(queue.pending()).toEqual([]);
    expect(storage.getItem(`${KEY}.bad`)).toBe(raw);
    expect(error).toHaveBeenCalledTimes(1);
    expect(queue.set("q1", { items: ["a"] }).seq).toBe(1);
  },
);
