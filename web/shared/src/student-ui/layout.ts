/**
 * Progress segment geometry in design pixels (see `--k-px` in tokens.css).
 * Progress passes both to its stylesheet, so they are set only here.
 */
export const SEGMENT_WIDTH = 40;
export const SEGMENT_GAP = 6;

/**
 * Returns how to lay out answer tiles: a 2×2 `grid` only when there are at most
 * four options and each one wraps to at most two lines at half width
 * (`lineCounts`, measured in that grid); full-width `rows` otherwise. When
 * options carry pictures (`hasImages`) the line counts don't matter: at most
 * four options make a grid, with each picture above its text, and more make
 * rows, with each picture at the left.
 */
export function chooseLayout(
  count: number,
  lineCounts: number[],
  hasImages = false,
): "grid" | "rows" {
  if (count > 4) return "rows";
  return hasImages || lineCounts.every((n) => n <= 2) ? "grid" : "rows";
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

/** How many tile density steps QuestionSheet has, from 0 (the design's). */
export const DENSITIES = 3;

/**
 * Returns the next denser step to try when content `contentHeight` tall
 * overflows a view `viewHeight` tall, or null when `density` is final: the
 * content fits, or no denser step is left. Heights within 1px count as fitting.
 */
export function nextDensity(
  contentHeight: number,
  viewHeight: number,
  density: number,
): number | null {
  return contentHeight > viewHeight + 1 && density < DENSITIES - 1
    ? density + 1
    : null;
}

/**
 * Counts the tiles whose bottom edge (`bottoms`, in the same coordinates)
 * lies more than 1px below `visibleBottom`, so are not fully in view.
 */
export function countBelow(bottoms: number[], visibleBottom: number): number {
  return bottoms.filter((b) => b > visibleBottom + 1).length;
}
