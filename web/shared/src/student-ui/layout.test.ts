import { expect, test } from "vitest";
import { chooseLayout, progressMode } from "./layout";

test("chooseLayout", () => {
  expect(chooseLayout(4, [1, 1, 2, 1])).toBe("grid");
  expect(chooseLayout(4, [1, 3, 1, 1])).toBe("rows");
  expect(chooseLayout(5, [1, 1, 1, 1, 1])).toBe("rows");
});

test("progressMode", () => {
  expect(progressMode(9, 600)).toBe("segments");
  expect(progressMode(40, 1000)).toBe("compact");
});
