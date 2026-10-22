import { expect, test } from "vitest";
import { contrast, PALETTES, type Palette } from "./palettes";

// --k-paper and --k-on-dark in tokens.css.
const WHITE = "#FFFFFF";

/** `fg` at `alpha` over `bg`, as #RRGGBB. */
function over(fg: string, alpha: number, bg: string): string {
  const mixed = [1, 3, 5].map((i) => {
    const [f, b] = [fg, bg].map((c) => Number.parseInt(c.slice(i, i + 2), 16));
    return Math.round(f * alpha + b * (1 - alpha));
  });
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Every colour pair the student screens draw: text at 4.5:1, focus rings and
 * answered-against-open states at 3:1. The grade ring's arc is left out, since
 * the grade itself is written inside it.
 */
const PAIRS: [string, (p: Palette) => [string, string], number][] = [
  ["question text and titles on the sheet", (p) => [p.ink, WHITE], 4.5],
  ["question number, grade and badge letter", (p) => [p.sel, WHITE], 4.5],
  ["«з N», key hint and «з 12» on the sheet", (p) => [p.muted, WHITE], 4.5],
  ["answer mode chip", (p) => [p.sel, p.soft], 4.5],
  ["tile and finish chip text", (p) => [p.ink, p.tile], 4.5],
  ["key caps", (p) => [p.sel, p.tile], 4.5],
  ["selected tile text", (p) => [WHITE, p.sel], 4.5],
  ["text and check mark on the accent", (p) => [p.ink, p.accent], 4.5],
  ["progress chip and timer text", (p) => [WHITE, p.track], 4.5],
  ["toast title", (p) => [WHITE, p.ink], 4.5],
  ["toast detail", (p) => [over(WHITE, 0.75, p.ink), p.ink], 4.5],
  ["top bar text", (p) => [p.onField, p.field], 4.5],
  ["top bar secondary text", (p) => [p.onFieldSoft, p.field], 4.5],
  ["focus ring on the sheet", (p) => [p.focus, WHITE], 3],
  ["focus ring on the field", (p) => [p.focus, p.field], 3],
  ["focus ring beside a tile", (p) => [p.focus, p.tile], 3],
  ["answered progress segment", (p) => [p.accent, p.track], 3],
  ["number on an open question grid cell", (p) => [WHITE, p.track], 4.5],
  ["number on an answered question grid cell", (p) => [p.ink, p.accent], 4.5],
  ["answered against open question grid cell", (p) => [p.accent, p.track], 3],
];

test("contrast spans 1 to 21", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  expect(contrast("#5A3FD6", "#5A3FD6")).toBe(1);
});

test("every palette meets contrast where the screens draw it", () => {
  for (const [id, p] of Object.entries(PALETTES)) {
    for (const [what, pair, min] of PAIRS) {
      const [fg, bg] = pair(p);
      expect(contrast(fg, bg), `${id}: ${what}`).toBeGreaterThanOrEqual(min);
    }
  }
});
