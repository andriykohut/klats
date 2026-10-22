import type { MotionProps, Transition } from "motion/react";

/*
 * Motion timings shared by the student components, taken from the design's
 * curves. Offsets are percentages of the element's own size, so they scale
 * with the screen like everything else. Each preset takes `reduced`, from
 * useReducedMotionConfig(): MotionConfig already drops the transforms, and
 * `reduced` makes the remaining fades instant too.
 */

const instant = { duration: 0, delay: 0 } satisfies Transition;

/**
 * A sheet slides in from the right, settling with a slight overshoot, and
 * leaves to the left. Wrap sheets in `<AnimatePresence mode="wait">`.
 */
export function sheet(reduced: boolean | null) {
  return {
    initial: { opacity: 0, x: "10%", rotate: 2.5 },
    animate: { opacity: 1, x: "0%", rotate: 0 },
    exit: {
      opacity: 0,
      x: "-9%",
      rotate: -3,
      transition: reduced
        ? instant
        : { duration: 0.28, ease: [0.5, 0, 0.75, 0] },
    },
    transition: reduced
      ? instant
      : { duration: 0.7, ease: [0.3, 1.25, 0.6, 1] },
  } satisfies MotionProps;
}

/** Tiles and chips pop up after their sheet arrives; `delay` staggers them. */
export function popIn(delay: number, reduced: boolean | null) {
  return {
    initial: { opacity: 0, y: "20%", scale: 0.95 },
    animate: { opacity: 1, y: "0%", scale: 1 },
    transition: reduced
      ? instant
      : { duration: 0.55, ease: [0.34, 1.56, 0.64, 1], delay },
  } satisfies MotionProps;
}

/** The grade counting up and its ring filling. */
export function countUp(reduced: boolean | null) {
  return (
    reduced ? instant : { duration: 1.2, delay: 0.3, ease: [0.2, 0.8, 0.2, 1] }
  ) satisfies Transition;
}

/** The connection toast drops in from above. */
export function toast(reduced: boolean | null) {
  return {
    initial: { opacity: 0, y: "-25%", scale: 0.96 },
    animate: { opacity: 1, y: "0%", scale: 1 },
    exit: { opacity: 0, y: "-25%", scale: 0.96 },
    transition: reduced
      ? instant
      : { type: "spring", visualDuration: 0.35, bounce: 0.4 },
  } satisfies MotionProps;
}
