import {
  type CSSProperties,
  type ReactNode,
  useSyncExternalStore,
} from "react";
import {
  CODE_LANGUAGES,
  getHighlighter,
  type HastNode,
  subscribeCode,
  TOKEN_COLOURS,
} from "./registry";

/**
 * A code block: `code` in a `pre`, with its tokens coloured when `language`
 * is one of `CODE_LANGUAGES` and a highlighter is registered (see
 * `setHighlighter`). Until then, and for a language it does not know, it
 * shows the plain text; it is highlighted as soon as a highlighter arrives.
 * The highlighter's tree is turned into elements, never into HTML.
 */
export function CodeView({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const highlight = useSyncExternalStore(subscribeCode, getHighlighter);
  const known = CODE_LANGUAGES.some((l) => l.id === language);
  return (
    <pre className="k-pre">
      <code>
        {highlight && known && language
          ? highlight(code, language).children.map(renderToken)
          : code}
      </code>
    </pre>
  );
}

function renderToken(node: HastNode, key: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const className = node.properties?.className;
  const classes = Array.isArray(className) ? className.map(String) : [];
  const token = classes
    .filter((c) => c.startsWith("hljs-"))
    .map((c) => c.slice(5))
    .find((c) => Object.hasOwn(TOKEN_COLOURS, c));
  const style: CSSProperties | undefined = token
    ? {
        color: TOKEN_COLOURS[token],
        fontStyle: token === "comment" ? "italic" : undefined,
      }
    : undefined;
  return (
    <span key={key} className={classes.join(" ")} style={style}>
      {node.children?.map(renderToken)}
    </span>
  );
}
