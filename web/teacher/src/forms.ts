/** The longest class or student name the server accepts, in characters. */
export const MAX_NAME = 60;

/** Returns the port typed in `text`, or null unless it is a whole number from 1 to 65535. */
export function parsePort(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,5}$/.test(t)) return null;
  const port = Number(t);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Returns what the server would refuse in a class, or null when it is fine:
 * a class name that is empty or longer than {@link MAX_NAME}, or else the
 * first student name longer than that. Empty student names are dropped by the
 * server, so they pass.
 */
export function classError(c: {
  name: string;
  students: string[];
}): { field: "name" } | { field: "student"; index: number } | null {
  const name = c.name.trim();
  if (name === "" || [...name].length > MAX_NAME) return { field: "name" };
  const index = c.students.findIndex((s) => [...s.trim()].length > MAX_NAME);
  return index < 0 ? null : { field: "student", index };
}
