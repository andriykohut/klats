import { expect, test } from "vitest";
import { route } from "./route";

const result = {
  scale: "points12",
  grade: 9,
  correct: 7,
  total: 9,
  pending: false,
};

test("writing loads the test unless it already syncs", () => {
  expect(route({ state: "writing" }, "pick", false)).toEqual({ to: "resume" });
  expect(route({ state: "writing" }, "test", true)).toEqual({ to: "stay" });
  expect(route({ state: "writing" }, "moved", true)).toEqual({ to: "stay" });
});

test("finished and ended go to the finish screen, with the result once it exists", () => {
  expect(route({ state: "finished", result }, "test", true)).toEqual({
    to: "finish",
    result,
  });
  expect(route({ state: "ended" }, "test", true)).toEqual({
    to: "finish",
    result: undefined,
  });
  expect(route({ state: "ended", result }, "finish", true)).toEqual({
    to: "finish",
    result,
  });
});

test("kicked and moved show their screens, moved only once", () => {
  expect(route({ state: "kicked" }, "test", false)).toEqual({ to: "kicked" });
  expect(route({ state: "moved" }, "review", true)).toEqual({ to: "moved" });
  expect(route({ state: "moved" }, "moved", true)).toEqual({ to: "stay" });
});

test("unjoined refetches the names on the list, stays on the join screens, and goes to the code elsewhere", () => {
  expect(route({ state: "unjoined" }, "pick", false)).toEqual({ to: "names" });
  expect(route({ state: "unjoined" }, "join", false)).toEqual({ to: "stay" });
  expect(route({ state: "unjoined" }, "typed", false)).toEqual({ to: "stay" });
  expect(route({ state: "unjoined" }, "finish", false)).toEqual({ to: "join" });
  expect(route({ state: "unjoined" }, "boot", false)).toEqual({ to: "join" });
});

test("another tab holding the test ignores every status", () => {
  for (const state of ["writing", "finished", "kicked", "moved", "unjoined"]) {
    expect(route({ state }, "otherTab", false)).toEqual({ to: "stay" });
  }
});
