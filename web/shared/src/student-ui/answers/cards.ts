import { walkNodes } from "../../rich/walk";

/**
 * Returns `placed`, the slot each placed card sits in, after card `card` goes
 * to `slot`, or back to the tray when `slot` is `null`. `capacity` says how
 * many cards each slot holds; a slot already full sends its earliest-placed
 * cards back to the tray to make room.
 */
export function place(
  placed: Record<string, string>,
  card: string,
  slot: string | null,
  capacity: Record<string, number>,
): Record<string, string> {
  const { [card]: _, ...rest } = placed;
  if (slot === null) return rest;
  const there = Object.keys(rest).filter((c) => rest[c] === slot);
  for (const c of there.slice(0, there.length + 1 - capacity[slot])) {
    delete rest[c];
  }
  return { ...rest, [card]: slot };
}

/** Returns `map` with keys and values swapped, for a map whose values differ. */
export function invert(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
}

/**
 * Returns the name a screen reader gets for an item with rich text `doc`: its
 * text, with a formula as its LaTeX, or `fallback` when it has none.
 */
export function nameOf(doc: unknown, fallback: string): string {
  const words: string[] = [];
  walkNodes(doc, (n) => {
    const part = n.text ?? n.attrs?.latex;
    if (part) words.push(part);
  });
  return words.join(" ").replace(/\s+/g, " ").trim() || fallback;
}
