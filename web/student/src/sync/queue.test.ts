import { expect, test } from "vitest";
import { memoryStorage } from "./memory-storage";
import { AnswerQueue } from "./queue";

const KEY = "klats.answers.p1";

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
