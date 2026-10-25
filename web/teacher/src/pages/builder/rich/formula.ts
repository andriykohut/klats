/** A palette button: its caption and the LaTeX it inserts. */
export interface Key {
  caption: string;
  snippet: string;
}

/**
 * The formula dialog's buttons, in the order they are shown. A snippet
 * that ends in a letter command ends in a space, so a letter typed after it
 * doesn't join it into an unknown command.
 */
export const PALETTE: Key[] = [
  { caption: "a/b", snippet: "\\frac{}{}" },
  { caption: "x²", snippet: "^{}" },
  { caption: "x₂", snippet: "_{}" },
  { caption: "√", snippet: "\\sqrt{}" },
  { caption: "ⁿ√", snippet: "\\sqrt[]{}" },
  { caption: "×", snippet: "\\times " },
  { caption: "÷", snippet: "\\div " },
  { caption: "·", snippet: "\\cdot " },
  { caption: "±", snippet: "\\pm " },
  { caption: "≠", snippet: "\\neq " },
  { caption: "≈", snippet: "\\approx " },
  { caption: "≤", snippet: "\\leq " },
  { caption: "≥", snippet: "\\geq " },
  { caption: "π", snippet: "\\pi " },
  { caption: "°", snippet: "^{\\circ}" },
  { caption: "α", snippet: "\\alpha " },
  { caption: "β", snippet: "\\beta " },
  { caption: "γ", snippet: "\\gamma " },
  { caption: "Δ", snippet: "\\Delta " },
  { caption: "∞", snippet: "\\infty " },
  { caption: "→", snippet: "\\rightarrow " },
];

/**
 * Replaces `latex` between `start` and `end` with `snippet` and returns the
 * result with the caret to put after it. Selected text goes into the
 * snippet's first `{}`. The caret lands in the first `{}` left empty, or after
 * the snippet when there is none.
 */
export function insertSnippet(
  latex: string,
  start: number,
  end: number,
  snippet: string,
): { latex: string; caret: number } {
  const selected = latex.slice(start, end);
  const filled = selected ? snippet.replace("{}", `{${selected}}`) : snippet;
  const hole = filled.indexOf("{}");
  return {
    latex: latex.slice(0, start) + filled + latex.slice(end),
    caret: start + (hole < 0 ? filled.length : hole + 1),
  };
}

/**
 * Returns where the caret goes on Tab: into the next empty `{}` after
 * `caret`, else past the next `}`. It is null when neither follows, so Tab
 * leaves the field.
 */
export function nextHole(latex: string, caret: number): number | null {
  const hole = latex.indexOf("{}", caret);
  if (hole >= 0) return hole + 1;
  const close = latex.indexOf("}", caret);
  return close >= 0 ? close + 1 : null;
}
