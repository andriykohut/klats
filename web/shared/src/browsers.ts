/**
 * The oldest browsers student pages run in: Chrome 109 (and Edge 109) and
 * Firefox 115, the last releases for Windows 7 and 8, which many school lab
 * PCs still run. Phones add Safari 16.4: iOS 16 brought the container
 * query units `--k-px` is made of, so an iPhone on iOS 15 or older can't lay
 * the pages out, and every iPhone with iOS 16 can update to 16.4. The student
 * Vite config builds JS and minifies CSS for {@link buildTarget}, and lowers
 * CSS for {@link cssTargets}, which keeps the `-webkit-` prefixes Safari
 * still needs. Raising the floor is a one-line change to `FLOOR`.
 *
 * While this floor stands, shared and student code avoids what these browsers
 * lack and the build does not polyfill:
 * - JS: `Array.prototype.toSorted`, `toReversed`, `toSpliced` and `with`;
 *   `Object.groupBy`; `Promise.withResolvers`; the new `Set` methods;
 *   `structuredClone` of class instances; `Intl.Segmenter` (Firefox 125).
 * - CSS: `:has()` (Firefox 115), `field-sizing` (Chrome 123), `color-mix()`
 *   with CSS variables (Chrome 109, and Lightning CSS cannot lower it;
 *   precompute shades as hex instead), View Transitions, `@property` and
 *   `linear()` easing.
 */
const FLOOR = { chrome: 109, firefox: 115, safari: [16, 4] };

const safari = FLOOR.safari.join(".");

/**
 * Vite `build.target`, which `build.cssTarget` follows, so the CSS minifier
 * keeps the prefixes these browsers need.
 */
export const buildTarget = [
  `chrome${FLOOR.chrome}`,
  `firefox${FLOOR.firefox}`,
  `safari${safari}`,
  `ios${safari}`,
];

/** Lightning CSS `targets`: major version in the top 16 bits, minor in the next 8. */
const [major, minor] = FLOOR.safari;
export const cssTargets = {
  chrome: FLOOR.chrome << 16,
  firefox: FLOOR.firefox << 16,
  safari: (major << 16) | (minor << 8),
  ios_saf: (major << 16) | (minor << 8),
};
