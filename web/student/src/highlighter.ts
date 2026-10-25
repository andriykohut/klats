import { lowlight } from "@klats/shared/code/lowlight.ts";
import { setHighlighter } from "@klats/shared/code/registry.ts";

/*
 * The only module of the student app that imports lowlight. `loadHighlighter`
 * (code.ts) imports it on demand, so lowlight and the grammars stay out of
 * the main chunk.
 */
setHighlighter((code, language) => lowlight.highlight(language, code));
