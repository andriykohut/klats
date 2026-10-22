/**
 * Returns the JSON value stored under `key` when `valid` accepts it, or null
 * when there is none. An unreadable value (not JSON, or rejected by `valid`)
 * is copied to `<key>.bad`, replacing any older copy, logged once, and also
 * read as null, so the caller starts empty instead of failing.
 */
export function readStored<T>(
  storage: Storage,
  key: string,
  valid: (value: unknown) => value is T,
): T | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (valid(value)) return value;
  } catch {
    // Not JSON: set aside below like any other unreadable value.
  }
  try {
    storage.setItem(`${key}.bad`, raw);
    console.error(`Unreadable ${key} in storage, copied to ${key}.bad`);
  } catch (err) {
    console.error(
      `Unreadable ${key} in storage, and no room to keep a copy`,
      err,
    );
  }
  return null;
}
