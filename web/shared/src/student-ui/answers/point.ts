import type { Point } from "../../generated/testfmt";

const STEP = 0.02;
const BIG_STEP = 0.1;
const DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Returns `p` moved by the arrow key `key`: 0.02 of the image, or 0.1 when
 * `big`, kept within 0 to 1. It returns null for any other key.
 */
export function nudge(p: Point, key: string, big: boolean): Point | null {
  const d = DELTAS[key];
  if (!d) return null;
  const step = big ? BIG_STEP : STEP;
  // Rounding keeps repeated steps from drifting off the 0.02 grid.
  const move = (v: number, sign: number) =>
    sign === 0
      ? v
      : Math.min(1, Math.max(0, Math.round((v + sign * step) * 1e4) / 1e4));
  return { x: move(p.x, d[0]), y: move(p.y, d[1]) };
}
