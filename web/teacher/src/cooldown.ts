/**
 * Returns a press guard: it reports true for a press, then false for every
 * press in the next `ms`. A list's delete buttons share one, so once a row is
 * gone, the row that slides under the pointer can't take the second click of
 * a double-click. 400 ms covers a double-click at the usual system settings.
 */
export function cooldown(
  ms = 400,
  now: () => number = () => performance.now(),
): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < ms) return false;
    last = t;
    return true;
  };
}
