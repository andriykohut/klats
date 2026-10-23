import { expect, test } from "vitest";
import { fitSize, keepOriginal } from "./media";

test("fitSize scales the long side down to the limit and never up", () => {
  expect(fitSize(4000, 3000)).toEqual({ w: 1600, h: 1200 });
  expect(fitSize(1000, 2000)).toEqual({ w: 800, h: 1600 });
  expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
  expect(fitSize(1600, 1600)).toEqual({ w: 1600, h: 1600 });
  expect(fitSize(10000, 3)).toEqual({ w: 1600, h: 1 });
});

test("keepOriginal keeps small web images and nothing else", () => {
  const KB = 1024;
  expect(keepOriginal("image/jpeg", 300 * KB, 1200, 800)).toBe(true);
  expect(keepOriginal("image/gif", 900 * KB, 400, 400)).toBe(true);
  expect(keepOriginal("image/png", 1024 * KB, 1600, 1600)).toBe(true);
  expect(keepOriginal("image/webp", 10 * KB, 10, 10)).toBe(true);
  expect(keepOriginal("image/jpeg", 2048 * KB, 1200, 800)).toBe(false);
  expect(keepOriginal("image/jpeg", 300 * KB, 2000, 1000)).toBe(false);
  expect(keepOriginal("image/jpeg", 300 * KB, 1000, 1601)).toBe(false);
  expect(keepOriginal("image/bmp", 10 * KB, 10, 10)).toBe(false);
});
