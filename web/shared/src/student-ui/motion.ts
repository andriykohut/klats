import type { MotionProps, Transition } from "motion/react";

/*
 * Motion timings shared by the student components, taken from the design's
 * curves. Offsets are percentages of the element's own size, so they scale
 * with the screen like everything else.
 */

/**
 * A sheet slides in from the right, settling with a slight overshoot, and
 * leaves to the left. Wrap sheets in `<AnimatePresence mode="wait">`.
 */
export const sheet = {
  initial: { opacity: 0, x: "10%", rotate: 2.5 },
  animate: { opacity: 1, x: "0%", rotate: 0 },
  exit: {
    opacity: 0,
    x: "-9%",
    rotate: -3,
    transition: { duration: 0.28, ease: [0.5, 0, 0.75, 0] },
  },
  transition: { duration: 0.7, ease: [0.3, 1.25, 0.6, 1] },
} satisfies MotionProps;

/** Tiles and chips pop up after their sheet arrives; `delay` staggers them. */
export function popIn(delay: number) {
  return {
    initial: { opacity: 0, y: "20%", scale: 0.95 },
    animate: { opacity: 1, y: "0%", scale: 1 },
    transition: { duration: 0.55, ease: [0.34, 1.56, 0.64, 1], delay },
  } satisfies MotionProps;
}

/** The grade counting up and its ring filling. */
export const countUp = {
  duration: 1.2,
  delay: 0.3,
  ease: [0.2, 0.8, 0.2, 1],
} satisfies Transition;

/** The connection toast drops in from above. */
export const toast = {
  initial: { opacity: 0, y: "-25%", scale: 0.96 },
  animate: { opacity: 1, y: "0%", scale: 1 },
  exit: { opacity: 0, y: "-25%", scale: 0.96 },
  transition: { type: "spring", visualDuration: 0.35, bounce: 0.4 },
} satisfies MotionProps;
