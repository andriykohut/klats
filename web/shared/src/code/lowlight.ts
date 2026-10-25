import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import delphi from "highlight.js/lib/languages/delphi";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import { createLowlight } from "lowlight";
import { CODE_LANGUAGES } from "./registry";

/*
 * lowlight with the grammars of {@link CODE_LANGUAGES}, each registered under
 * its language id. It is the only module that imports lowlight and the
 * grammars at run time; the student app imports it from its own lazy chunk,
 * and the teacher app at startup, so the main student chunk never reaches it.
 */
const grammars = { python, cpp, delphi, javascript, xml, css };

export const lowlight = createLowlight(
  Object.fromEntries(
    CODE_LANGUAGES.map((l) => [
      l.id,
      grammars[l.grammar as keyof typeof grammars],
    ]),
  ),
);
