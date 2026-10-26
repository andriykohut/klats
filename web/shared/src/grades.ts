import { m } from "./paraglide/messages.js";

/** The four achievement levels a grade falls in, on any scale. */
export type Band = "min" | "lo" | "mid" | "hi";

/**
 * Formats a grade of the scale `scale` (the kind of a test's grading scale):
 * «9», «87%» or the word for a pass or a fail, where a pass is grade 1.
 */
export function gradeText(scale: string, grade: number): string {
  if (scale === "percent") return m.grade_percent({ n: grade });
  if (scale === "pass") return grade ? m.grade_pass() : m.grade_fail();
  return String(grade);
}

/**
 * Formats the mean `average` of the grades of a scale in `locale`: to one
 * decimal, and for pass/fail, where the mean is the share that passed (0 to
 * 1), as «72% зараховано».
 */
export function averageText(
  scale: string,
  average: number,
  locale: string,
): string {
  if (scale === "pass") {
    return m.grade_average_pass({ percent: Math.round(average * 100) });
  }
  const text = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(average);
  return scale === "percent" ? m.grade_percent({ n: text }) : text;
}

/**
 * Returns the achievement level of a grade: 10-12, 7-9, 4-6 and 1-3 on the
 * 12-point scale, the percent of those grades of the default table (83, 58 and
 * 33) on the percent scale, and «hi» or «min» for a pass or a fail.
 */
export function gradeBand(scale: string, grade: number): Band {
  if (scale === "pass") return grade ? "hi" : "min";
  const [hi, mid, lo] = scale === "percent" ? [83, 58, 33] : [10, 7, 4];
  if (grade >= hi) return "hi";
  if (grade >= mid) return "mid";
  if (grade >= lo) return "lo";
  return "min";
}

/** Returns how full a grade of the scale is, from 0 to 1. */
export function gradeFill(scale: string, grade: number): number {
  if (scale === "pass") return grade ? 1 : 0;
  return grade / (scale === "percent" ? 100 : 12);
}

/**
 * The lowest percent for grades 2 to 12 of the default 12-point table: grade g
 * needs g/12 of the points, in whole percents. It mirrors
 * `testfmt.DefaultThresholds` in Go, which tygo does not export as a value.
 */
export const DEFAULT_THRESHOLDS = [16, 25, 33, 41, 50, 58, 66, 75, 83, 91, 100];
