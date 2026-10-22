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
  expect(queue.set("q1", ["a"]).seq).toBe(1);
  expect(queue.set("q1", ["b"]).seq).toBe(2);
  expect(queue.set("q2", ["c"]).seq).toBe(1);

  const reloaded = new AnswerQueue(storage, KEY, "p1");
  expect(reloaded.current("q1")).toEqual(["b"]);
  expect(reloaded.set("q1", ["a"]).seq).toBe(3);
});

test("a change carries the participant and a 16-byte hex change id", () => {
  const queue = new AnswerQueue(memoryStorage(), KEY, "p1");
  const change = queue.set("q1", ["a", "b"]);
  expect(change).toMatchObject({
    participantId: "p1",
    questionId: "q1",
    optionIds: ["a", "b"],
    seq: 1,
  });
  expect(change.changeId).toMatch(/^[0-9a-f]{32}$/);
  expect(queue.set("q1", []).changeId).not.toBe(change.changeId);
});

test("only the newest unsent change of a question is kept", () => {
  const queue = new AnswerQueue(memoryStorage(), KEY, "p1");
  queue.set("q1", ["a"]);
  const q2 = queue.set("q2", ["c"]);
  const q1 = queue.set("q1", ["b"]);
  expect(queue.pending()).toEqual([q2, q1]);
});

test("ack removes only acknowledged changes", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  const a = queue.set("q1", ["a"]);
  const b = queue.set("q2", ["b"]);
  queue.ack([a.changeId, "unknown"]);
  expect(queue.pending()).toEqual([b]);
  expect(queue.current("q1")).toEqual(["a"]);
  expect(new AnswerQueue(storage, KEY, "p1").pending()).toEqual([b]);
});

test("restore keeps newer local answer", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  for (const ids of [["a"], ["b"], ["c"], ["d"]]) queue.set("q1", ids);
  const local = queue.set("q3", ["x"]);
  queue.ack([local.changeId]);
  queue.set("q4", ["y"]);

  queue.restore(
    [
      { questionId: "q1", optionIds: ["z"], seq: 2 },
      { questionId: "q2", optionIds: ["s"], seq: 3 },
      { questionId: "q3", optionIds: ["t"], seq: 1 },
      { questionId: "q4", optionIds: ["u"], seq: 5 },
    ],
    0,
  );

  // q1: local seq 4 beats the server's 2 and stays pending.
  expect(queue.current("q1")).toEqual(["d"]);
  expect(queue.pending().map((c) => [c.questionId, c.seq])).toEqual([
    ["q1", 4],
  ]);
  // q2 and q4: the server's answer wins and the unsent local change is dropped.
  // q3: an equal seq adopts the server's answer.
  expect(queue.current("q2")).toEqual(["s"]);
  expect(queue.current("q3")).toEqual(["t"]);
  expect(queue.current("q4")).toEqual(["u"]);

  const reloaded = new AnswerQueue(storage, KEY, "p1");
  expect(reloaded.current("q4")).toEqual(["u"]);
  expect(reloaded.set("q1", []).seq).toBe(5);
  expect(reloaded.set("q2", []).seq).toBe(4);
  expect(reloaded.set("q4", []).seq).toBe(6);
});

test("every change after a restore exceeds the seq base, across reloads", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  queue.restore([{ questionId: "q1", optionIds: ["a"], seq: 2 }], 3_000_000);
  expect(queue.current("q1")).toEqual(["a"]);
  expect(queue.set("q1", ["b"]).seq).toBe(3_000_001);
  expect(queue.set("q2", ["c"]).seq).toBe(3_000_001);
  // A server seq above the base still counts.
  queue.restore(
    [{ questionId: "q3", optionIds: ["d"], seq: 3_000_007 }],
    3_000_000,
  );
  expect(queue.set("q3", ["e"]).seq).toBe(3_000_008);
  expect(new AnswerQueue(storage, KEY, "p1").set("q4", []).seq).toBe(3_000_001);
});

/** One participant's answers on the server, which stores a change only when its seq is higher. */
function fakeServer() {
  const rows = new Map<string, StoredAnswer>();
  return {
    /** Delivers and acks everything the queue holds. */
    deliver(queue: AnswerQueue) {
      const changes = queue.pending();
      for (const { questionId, optionIds, seq } of changes) {
        const held = rows.get(questionId);
        if (!held || seq > held.seq) {
          rows.set(questionId, { questionId, optionIds, seq });
        }
      }
      queue.ack(changes.map((c) => c.changeId));
    },
    answers: () => [...rows.values()],
    held: (questionId: string) => rows.get(questionId)?.optionIds,
  };
}

test("after a move the new device outranks the old one's leftovers, which fill the rest", () => {
  const server = fakeServer();
  // Device A, before any move: q3 reaches the server at seq 7, then A goes
  // offline and changes q2 three times, q3 twice and q4 once.
  const a = new AnswerQueue(memoryStorage(), KEY, "p1");
  a.restore(server.answers(), 0);
  for (let i = 1; i <= 7; i++) a.set("q3", [`s${i}`]);
  server.deliver(a);
  for (const ids of [["x"], ["y"], ["A-q2"]]) a.set("q2", ids);
  a.set("q3", ["a1"]);
  a.set("q3", ["A-q3"]);
  a.set("q4", ["A-q4"]);

  // The teacher moves the student to device B, which answers q2 and q3 once.
  const bStorage = memoryStorage();
  const b = new AnswerQueue(bStorage, KEY, "p1");
  b.restore(server.answers(), 1_000_000);
  b.set("q2", ["B-q2"]);
  b.set("q3", ["B-q3"]);
  server.deliver(b);

  // A comes back and drains.
  server.deliver(a);
  expect(server.held("q2")).toEqual(["B-q2"]);
  expect(server.held("q3")).toEqual(["B-q3"]);
  expect(server.held("q4")).toEqual(["A-q4"]);

  // B reloads and restores with the same base: no second jump.
  const reloaded = new AnswerQueue(bStorage, KEY, "p1");
  reloaded.restore(server.answers(), 1_000_000);
  expect(reloaded.current("q4")).toEqual(["A-q4"]);
  expect(reloaded.set("q2", ["B2"]).seq).toBe(1_000_002);
  expect(reloaded.set("q5", ["new"]).seq).toBe(1_000_001);
});

test("a failed write keeps the answers in memory and is retried on the next", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  queue.set("q1", ["a"]);
  queue.set("q2", ["b"]);
  expect(queue.saveFailed).toBe(true);
  expect(error).toHaveBeenCalledTimes(1);
  expect(queue.pending()).toHaveLength(2);

  setItem.mockRestore();
  queue.set("q3", ["c"]);
  expect(queue.saveFailed).toBe(false);
  expect(new AnswerQueue(storage, KEY, "p1").pending()).toHaveLength(3);
});

const saved = (answers: unknown[], pending: unknown[], v = 1) =>
  JSON.stringify({ v, seqBase: 0, answers, pending });

test.each([
  "{not json",
  "{}",
  saved([], [], 2),
  saved([null], []),
  saved([], [null]),
  saved([{ questionId: "q1", optionIds: [1], seq: 1 }], []),
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
    expect(queue.set("q1", ["a"]).seq).toBe(1);
  },
);
