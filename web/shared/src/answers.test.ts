import { expect, test } from "vitest";
import { isAnswered } from "./answers";

test("isAnswered", () => {
  expect([undefined, {}, { text: " " }, { items: [] }].map(isAnswered)).toEqual(
    [false, false, false, false],
  );
  expect(
    [{ items: ["a"] }, { text: "x" }, { point: { x: 0, y: 0 } }].map(
      isAnswered,
    ),
  ).toEqual([true, true, true]);
});
