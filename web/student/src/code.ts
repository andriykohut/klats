/**
 * Loads lowlight with the grammars of code blocks and registers it as the
 * highlighter. It rejects when the chunk can't be fetched, and a second call
 * can't recover from that; code blocks then stay plain text.
 */
export async function loadHighlighter(): Promise<void> {
  await import("./highlighter");
}
