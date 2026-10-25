const KEPT = new Set(["uk-UA", "en-US"]);
const REMOVED = "\0react-aria-locale-removed";

/**
 * A Vite plugin that drops React Aria's built-in strings for every language
 * but the two the apps ship, Ukrainian and English. React Aria bundles about
 * 34 languages of strings for each widget, and the dropped ones add tens of
 * kilobytes to the student app's JS budget.
 *
 * It matches imports of `<language>-<REGION>.<ext>` files made from inside
 * react-aria, react-aria-components and react-stately, and points the dropped
 * ones at a module whose default export is `undefined`. React Aria's string
 * dictionary ignores such entries and falls back to en-US for a language it
 * lacks. If a React Aria release lays its files out differently, nothing
 * matches and the build only loses this saving, which `make size` shows.
 *
 * It is declared without Vite's types, which the apps have and this package
 * does not.
 */
export const reactAriaUkEnOnly = {
  name: "react-aria-uk-en-only",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    const locale = /(?:^|\/)([a-z]{2}-[A-Z]{2})\.(?:m?js|cjs)$/.exec(
      source,
    )?.[1];
    if (!locale || KEPT.has(locale)) return null;
    if (
      !importer ||
      !/[\\/]react-(?:aria|aria-components|stately)[\\/]/.test(importer)
    ) {
      return null;
    }
    return REMOVED;
  },
  load(id: string) {
    return id === REMOVED ? "export default undefined;" : null;
  },
};
