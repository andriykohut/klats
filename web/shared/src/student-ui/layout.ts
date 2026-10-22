/** Width of one progress segment plus its gap, in design pixels (see tokens.css). */
export const SEGMENT_PITCH = 46;

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
 * Returns `segments` when `total` progress segments fit in `width` (in design
 * pixels, see {@link SEGMENT_PITCH}), and `compact` otherwise.
 */
export function progressMode(
  total: number,
  width: number,
): "segments" | "compact" {
  return total * SEGMENT_PITCH <= width ? "segments" : "compact";
}
