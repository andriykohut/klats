import { lowlight as shared } from "@klats/shared/code/lowlight.ts";
import { setHighlighter, TOKEN_COLOURS } from "@klats/shared/code/registry.ts";

/**
 * The shared lowlight for the editor's code blocks. Its `highlightAuto` finds
 * nothing, so a block without a language stays plain where the editor would
 * otherwise guess one.
 */
export const lowlight = {
  ...shared,
  highlightAuto: () => ({ type: "root" as const, children: [] }),
};

setHighlighter((code, language) => shared.highlight(language, code));

// The editor marks tokens with hljs-* classes and leaves their colours to the
// page; the rules come from the same colours the student's page applies. A
// style element, not an adopted stylesheet, which older WebKit lacks.
const style = document.createElement("style");
style.textContent = [
  ...Object.entries(TOKEN_COLOURS).map(
    ([token, colour]) => `.b-rich-input .hljs-${token} { color: ${colour}; }`,
  ),
  ".b-rich-input .hljs-comment { font-style: italic; }",
].join("\n");
document.head.append(style);
