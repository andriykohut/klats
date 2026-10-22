/**
 * Progress segment geometry in design pixels (see `--k-px` in tokens.css).
 * Progress passes both to its stylesheet, so they are set only here.
 */
export const SEGMENT_WIDTH = 40;
export const SEGMENT_GAP = 6;

/**
 * Returns how to lay out answer tiles: a 2×2 `grid` only when there are at most
 * four options and each one wraps to at most two lines at half width
 * (`lineCounts`, measured in that grid); full-width `rows` otherwise.
 */
export function chooseLayout(
  count: number,
  lineCounts: number[],
): "grid" | "rows" {
  return count <= 4 && lineCounts.every((n) => n <= 2) ? "grid" : "rows";
}

/**
 * Returns `segments` when `total` progress segments, each
 * {@link SEGMENT_WIDTH} plus {@link SEGMENT_GAP}, fit in `width` design
 * pixels, and `compact` otherwise.
 */
export function progressMode(
  total: number,
  width: number,
): "segments" | "compact" {
  return total * (SEGMENT_WIDTH + SEGMENT_GAP) <= width
    ? "segments"
    : "compact";
}
