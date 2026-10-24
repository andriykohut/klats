import { KATEX_OPTIONS, setMathRenderer } from "@klats/shared/math/registry.ts";
import katex from "katex";
import "katex/dist/katex.min.css";

setMathRenderer((latex, el) => katex.render(latex, el, KATEX_OPTIONS));

/** Reports whether KaTeX can't read `latex`; the formula dialog disables «Вставити» on it. */
export function latexBroken(latex: string): boolean {
  try {
    katex.renderToString(latex, { ...KATEX_OPTIONS, throwOnError: true });
    return false;
  } catch {
    return true;
  }
}
