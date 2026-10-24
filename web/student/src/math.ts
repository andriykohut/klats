/**
 * Loads KaTeX, registers it as the formula renderer, and fetches its font
 * faces, so formulas still draw after the network drops. Fonts a browser
 * fetches only when a glyph first needs it would otherwise be missing by then.
 * It rejects when the chunk can't be fetched; call it again to retry.
 */
export async function loadMath(): Promise<void> {
  await import("./katex");
  const faces = [...document.fonts].filter((f) =>
    f.family.replace(/["']/g, "").startsWith("KaTeX"),
  );
  // A face that fails to load only costs its glyphs; the formula still draws.
  await Promise.all(faces.map((f) => f.load().catch(() => f)));
}
