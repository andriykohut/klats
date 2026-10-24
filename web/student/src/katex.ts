import { KATEX_OPTIONS, setMathRenderer } from "@klats/shared/math/registry.ts";
import katex from "katex";
import "katex/dist/katex.min.css";

/*
 * The only module that imports KaTeX. {@link loadMath} imports it on demand,
 * so the library, its style and its fonts stay out of the main chunk.
 */
setMathRenderer((latex, el) => katex.render(latex, el, KATEX_OPTIONS));
