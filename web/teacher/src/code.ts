import {
  CODE_LANGUAGES,
  setHighlighter,
  TOKEN_COLOURS,
} from "@klats/shared/code/registry.ts";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import delphi from "highlight.js/lib/languages/delphi";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import { createLowlight } from "lowlight";

const grammars = { python, cpp, delphi, javascript, xml, css };

/**
 * lowlight with the grammars of code blocks, each under its language id. Its
 * `highlightAuto` finds nothing, so a block without a language stays plain
 * where the editor would otherwise guess one.
 */
export const lowlight = {
  ...createLowlight(
    Object.fromEntries(
      CODE_LANGUAGES.map((l) => [
        l.id,
        grammars[l.grammar as keyof typeof grammars],
      ]),
    ),
  ),
  highlightAuto: () => ({ type: "root" as const, children: [] }),
};

setHighlighter((code, language) => lowlight.highlight(language, code));

// The editor marks tokens with hljs-* classes and leaves their colours to the
// page; the rules come from the same colours the student's page applies.
const sheet = new CSSStyleSheet();
sheet.replaceSync(
  [
    ...Object.entries(TOKEN_COLOURS).map(
      ([token, colour]) => `.b-rich-input .hljs-${token} { color: ${colour}; }`,
    ),
    ".b-rich-input .hljs-comment { font-style: italic; }",
  ].join("\n"),
);
document.adoptedStyleSheets.push(sheet);
