/**
 * The oldest browsers student pages run in: Chrome 109 (and Edge 109) and
 * Firefox 115, the last releases for Windows 7 and 8, which many school lab
 * PCs still run. The student Vite config builds for {@link buildTarget} and
 * lowers CSS for {@link cssTargets}. Raising the floor is a one-line change
 * to `FLOOR`.
 *
 * While this floor stands, shared and student code avoids what these browsers
 * lack and the build does not polyfill:
 * - JS: `Array.prototype.toSorted`, `toReversed`, `toSpliced` and `with`;
 *   `Object.groupBy`; `Promise.withResolvers`; the new `Set` methods;
 *   `structuredClone` of class instances.
 * - CSS: `:has()` (Firefox 115), `color-mix()` with CSS variables (Chrome 109,
 *   and Lightning CSS cannot lower it; precompute shades as hex instead),
 *   View Transitions, `@property` and `linear()` easing.
 */
const FLOOR = { chrome: 109, firefox: 115 };

/** Vite `build.target`. */
export const buildTarget = [`chrome${FLOOR.chrome}`, `firefox${FLOOR.firefox}`];

/** Lightning CSS `targets`: major version shifted into the top 16 bits. */
export const cssTargets = {
  chrome: FLOOR.chrome << 16,
  firefox: FLOOR.firefox << 16,
};
