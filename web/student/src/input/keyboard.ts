import { BADGE_LETTERS } from "@klats/shared/student-ui/AnswerTile.tsx";

/**
 * Returns the index of the option a key picks: `1`–`9` and the badge letters
 * А Б В Г Д Е Є Ж З, in either case, pick options 0–8. It returns null for
 * any other key (Ґ, Latin look-alikes, `0`) and for an index at or past
 * `count`.
 */
export function keyToOption(key: string, count: number): number | null {
  const i = /^[1-9]$/.test(key)
    ? Number(key) - 1
    : BADGE_LETTERS.indexOf(key.toUpperCase());
  return i >= 0 && i < count ? i : null;
}
