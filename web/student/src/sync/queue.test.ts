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

  queue.restore([
    { questionId: "q1", optionIds: ["z"], seq: 2 },
    { questionId: "q2", optionIds: ["s"], seq: 3 },
    { questionId: "q3", optionIds: ["t"], seq: 1 },
    { questionId: "q4", optionIds: ["u"], seq: 5 },
  ]);

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

test("a fresh device numbers its changes far above the server's", () => {
  const storage = memoryStorage();
  const queue = new AnswerQueue(storage, KEY, "p1");
  queue.restore([
    { questionId: "q1", optionIds: ["a"], seq: 2 },
    { questionId: "q4", optionIds: ["d"], seq: 2 },
  ]);
  expect(queue.current("q1")).toEqual(["a"]);
  expect(queue.set("q1", ["b"]).seq).toBe(1_000_003);
  expect(queue.set("q1", ["c"]).seq).toBe(1_000_004);
  expect(queue.set("q2", ["c"]).seq).toBe(1_000_001);

  // A reload keeps the gap, and adopting a newer server answer (an old
  // device's leftover) keeps the question's base.
  const reloaded = new AnswerQueue(storage, KEY, "p1");
  expect(reloaded.set("q3", ["x"]).seq).toBe(1_000_001);
  reloaded.restore([{ questionId: "q4", optionIds: ["y"], seq: 5 }]);
  expect(reloaded.current("q4")).toEqual(["y"]);
  expect(reloaded.set("q4", ["z"]).seq).toBe(1_000_003);
});

test("a moved student's old device cannot overwrite the new one", () => {
  // Device A synced q1 at seq 2, then answered it offline up to seq 5.
  const a = new AnswerQueue(memoryStorage(), KEY, "p1");
  for (let i = 0; i < 5; i++) a.set("q1", [`a${i}`]);
  // The student is moved to device B, which starts from the server's seq 2.
  const b = new AnswerQueue(memoryStorage(), KEY, "p1");
  b.restore([{ questionId: "q1", optionIds: ["a1"], seq: 2 }]);
  const leftover = a.pending()[0]?.seq ?? 0;
  expect(leftover).toBe(5);
  expect(b.set("q1", ["b"]).seq).toBeGreaterThan(leftover);
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

test.each([
  "{not json",
  "{}",
  JSON.stringify({ v: 2, floor: 0, answers: [], pending: [] }),
])(
  "unreadable stored state %s is set aside and the queue starts fresh",
  (raw) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = memoryStorage();
    storage.setItem(KEY, raw);
    const queue = new AnswerQueue(storage, KEY, "p1");
    expect(queue.pending()).toEqual([]);
    expect(storage.getItem(`${KEY}.bad`)).toBe(raw);
    expect(error).toHaveBeenCalledTimes(1);
    queue.restore([]);
    expect(queue.set("q1", ["a"]).seq).toBe(1_000_001);
  },
);
