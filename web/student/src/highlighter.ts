import { CODE_LANGUAGES, setHighlighter } from "@klats/shared/code/registry.ts";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import delphi from "highlight.js/lib/languages/delphi";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import { createLowlight } from "lowlight";

/*
 * The only module of the student app that imports lowlight and the grammars.
 * {@link loadHighlighter} imports it on demand, so they stay out of the main
 * chunk.
 */
const grammars = { python, cpp, delphi, javascript, xml, css };
const lowlight = createLowlight(
  Object.fromEntries(
    CODE_LANGUAGES.map((l) => [
      l.id,
      grammars[l.grammar as keyof typeof grammars],
    ]),
  ),
);

setHighlighter((code, language) => lowlight.highlight(language, code));
