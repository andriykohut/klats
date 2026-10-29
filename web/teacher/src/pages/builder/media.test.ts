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

test("svgSize takes the declared size, then the viewBox, then 300×150, fitted to 1600 px", () => {
  // Browsers give an SVG without a size of its own a natural size anyway,
  // such as 200×150 for a 4:3 viewBox in Chromium.
  const auto = { w: 200, h: 150 };
  const cases: [
    typeof auto,
    string | null,
    string | null,
    string | null,
    string,
  ][] = [
    [{ w: 640, h: 480 }, "640", "480", "0 0 4 3", "640×480"],
    [{ w: 794, h: 1123 }, "21cm", "29.7cm", null, "794×1123"],
    [{ w: 4000, h: 3000 }, "4000", "3000", null, "1600×1200"],
    [auto, null, null, "0 0 800 600", "800×600"],
    [auto, "100%", "100%", "0 0 800 600", "800×600"],
    [auto, "640", null, "0 0 800 600", "800×600"],
    [{ w: 0, h: 0 }, "640", "480", "0 0 800 600", "800×600"],
    [auto, null, null, " -10,-10, 4000\n1000 ", "1600×400"],
    [{ w: 300, h: 150 }, null, null, null, "300×150"],
    [auto, "auto", "auto", null, "300×150"],
    [auto, null, null, "0 0 0 10", "300×150"],
    [auto, null, null, "0 0 4", "300×150"],
    [auto, null, null, "a b c d", "300×150"],
  ];
  for (const [natural, width, height, viewBox, want] of cases) {
    const { w, h } = svgSize(natural, { width, height, viewBox });
    expect(`${w}×${h}`, `${width} ${height} ${viewBox}`).toBe(want);
  }
});
