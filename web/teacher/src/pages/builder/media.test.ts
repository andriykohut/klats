import { expect, test } from "vitest";
import { fitSize, keepOriginal, svgSize } from "./media";

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

test("svgSize takes the natural size, then the viewBox, then 300×150, fitted to 1600 px", () => {
  expect(svgSize({ w: 640, h: 480 }, "0 0 4 3")).toEqual({ w: 640, h: 480 });
  expect(svgSize({ w: 4000, h: 3000 }, null)).toEqual({ w: 1600, h: 1200 });
  expect(svgSize({ w: 0, h: 0 }, "0 0 400 300")).toEqual({ w: 400, h: 300 });
  expect(svgSize({ w: 0, h: 0 }, " -10,-10, 4000\n1000 ")).toEqual({
    w: 1600,
    h: 400,
  });
  expect(svgSize({ w: 0, h: 0 }, null)).toEqual({ w: 300, h: 150 });
  expect(svgSize({ w: 0, h: 0 }, "0 0 0 10")).toEqual({ w: 300, h: 150 });
  expect(svgSize({ w: 0, h: 0 }, "0 0 4")).toEqual({ w: 300, h: 150 });
  expect(svgSize({ w: 0, h: 0 }, "a b c d")).toEqual({ w: 300, h: 150 });
});
