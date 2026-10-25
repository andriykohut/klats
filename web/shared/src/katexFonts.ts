/**
 * A Vite plugin that strips the woff and ttf sources from KaTeX's style, so
 * the build ships only the woff2 files. Every browser this program supports
 * reads woff2 and fetches nothing else, so the other two would only add about
 * 2 MB to each app. It runs before Vite resolves the style's `url()`s, which
 * is what makes it copy a font file. It is declared without Vite's types,
 * which the apps have and this package does not.
 */
export const katexWoff2Only = {
  name: "katex-woff2-only",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!/katex(\.min)?\.css$/.test(id)) return null;
    return code.replace(
      /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g,
      "",
    );
  },
};
