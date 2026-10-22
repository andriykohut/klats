import { Fragment, type ReactNode } from "react";

/** A text style. Known types: bold, italic, subscript, superscript. */
export interface RichMark {
  type: string;
}

/**
 * A node of a rich-text document. Known types: paragraph, text, hardBreak,
 * bulletList, orderedList, listItem. Only text nodes carry text and marks.
 */
export interface RichNode {
  type: string;
  text?: string;
  marks?: RichMark[];
  content?: RichNode[];
}

/** A rich-text document, as the server's rich package validates and stores it. */
export interface RichDoc {
  type: "doc";
  content?: RichNode[];
}

/**
 * Renders a rich-text document as React elements. A node or mark it does not
 * know renders as its children or text alone, so newer documents degrade
 * instead of failing.
 */
export function RichView({ doc }: { doc: RichDoc }) {
  return <>{doc.content?.map(renderNode)}</>;
}

function renderNode(node: RichNode, key: number): ReactNode {
  const children = node.content?.map(renderNode);
  switch (node.type) {
    case "text":
      return (
        <Fragment key={key}>
          {(node.marks ?? []).reduceRight(applyMark, node.text)}
        </Fragment>
      );
    case "paragraph":
      return <p key={key}>{children}</p>;
    case "hardBreak":
      return <br key={key} />;
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return <ol key={key}>{children}</ol>;
    case "listItem":
      return <li key={key}>{children}</li>;
    default:
      return <Fragment key={key}>{children ?? node.text}</Fragment>;
  }
}

function applyMark(inner: ReactNode, mark: RichMark): ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong>{inner}</strong>;
    case "italic":
      return <em>{inner}</em>;
    case "subscript":
      return <sub>{inner}</sub>;
    case "superscript":
      return <sup>{inner}</sup>;
    default:
      return inner;
  }
}
