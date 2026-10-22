import { expect, test } from "vitest";
import { chooseLayout, countBelow, nextDensity, progressMode } from "./layout";

test("chooseLayout", () => {
  expect(chooseLayout(4, [1, 1, 2, 1])).toBe("grid");
  expect(chooseLayout(4, [1, 3, 1, 1])).toBe("rows");
  expect(chooseLayout(5, [1, 1, 1, 1, 1])).toBe("rows");
});

test("progressMode", () => {
  expect(progressMode(9, 600)).toBe("segments");
  expect(progressMode(40, 1000)).toBe("compact");
});

test("nextDensity steps up only while the content overflows", () => {
  expect(nextDensity(500, 480, 0)).toBe(1);
  expect(nextDensity(500, 480, 1)).toBe(2);
  expect(nextDensity(500, 480, 2)).toBeNull();
  expect(nextDensity(480, 480, 0)).toBeNull();
  expect(nextDensity(480.8, 480, 1)).toBeNull();
});

test("countBelow counts tiles not fully in view", () => {
  expect(countBelow([100, 200, 300, 400], 250)).toBe(2);
  expect(countBelow([100, 200, 300, 400], 400)).toBe(0);
  expect(countBelow([100, 200, 300, 400.6], 400)).toBe(0);
  expect(countBelow([], 0)).toBe(0);
});
