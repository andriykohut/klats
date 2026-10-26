/*
 * The small rules the class journal shares between the live view and the
 * results: how names shrink for the projector and how a row of cells adds up
 * when it is drawn as one bar.
 */

/** Above this many questions a row is one bar instead of one cell each. */
export const COMPACT_AFTER = 40;

/** Returns the first letter of each part of `name` with a dot: «Ш. О.». */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}.`)
    .join(" ");
}

/** Returns the surname and the first name's initial: «Бондар О.». */
export function shortName(name: string): string {
  const [surname = "", first] = name.split(/\s+/).filter(Boolean);
  return first ? `${surname} ${first[0]}.` : surname;
}

/**
 * Counts a row's cells for its compact bar: `good` scored full points
 * ("correct", "full"), `bad` scored less ("wrong", "partial", "zero"),
 * `answered` hides which ("answered"), and `left` is every other cell but
 * "absent", a question the student did not get, which is not counted.
 */
export function tally(states: string[]): {
  good: number;
  bad: number;
  answered: number;
  left: number;
} {
  const t = { good: 0, bad: 0, answered: 0, left: 0 };
  for (const s of states) {
    if (s === "correct" || s === "full") t.good++;
    else if (s === "wrong" || s === "partial" || s === "zero") t.bad++;
    else if (s === "answered") t.answered++;
    else if (s !== "absent") t.left++;
  }
  return t;
}

/** Returns the width of the grade column: a pass or a fail is a word. */
export function gradeWidth(scale: string): number {
  return scale === "pass" ? 120 : 64;
}

/** Formats points with up to two decimals in `locale`: «0,5», «1». */
export function formatPoints(points: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    points,
  );
}

/**
 * Formats the moment `at` (unix ms) in `locale` with `options`, adding the
 * year when it differs from the year of `now`: a school year spans two.
 */
export function formatDate(
  at: number,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  now = Date.now(),
): string {
  const other = new Date(at).getFullYear() !== new Date(now).getFullYear();
  return new Intl.DateTimeFormat(
    locale,
    other ? { ...options, year: "numeric" } : options,
  ).format(at);
}
