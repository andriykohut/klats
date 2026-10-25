import { type CSSProperties, Fragment, type ReactNode, useState } from "react";
import { CodeView } from "../code/CodeView";
import { MathView } from "../math/MathView";
import { useMediaURL } from "../media";
import { m } from "../paraglide/messages.js";
import { AudioPlayer } from "../student-ui/AudioPlayer";
import "./rich.css";

/** A text style. Known types: bold, italic, subscript, superscript, code. */
export interface RichMark {
  type: string;
}

/** The attributes a node can carry; each node type uses a fixed subset. */
export interface RichAttrs {
  src?: string;
  w?: number;
  h?: number;
  latex?: string;
  language?: string;
  id?: string;
  colspan?: number;
  rowspan?: number;
}

/**
 * A node of a rich-text document. Known types: paragraph, text, hardBreak,
 * bulletList, orderedList, listItem, codeBlock, table, tableRow, tableHeader,
 * tableCell, image, audio, math, gap, word. Only text nodes carry text and marks.
 */
export interface RichNode {
  type: string;
  attrs?: RichAttrs;
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
 * instead of failing. Images and audio load through {@link useMediaURL}; one
 * that can't be loaded shows a note that it is still loading. A formula is
 * drawn by {@link MathView}, and a code block by {@link CodeView}. A gap
 * renders as what `gap` returns for its id, or as nothing without it. A word
 * node, which the server makes of a highlight question's body, renders as
 * what `word` returns for its index and its text, or as its text without it.
 * The index counts word nodes through the whole document, as Go's
 * `rich.Doc.Words` does.
 */
export function RichView({
  doc,
  gap,
  word,
}: {
  doc: RichDoc;
  gap?: (id: string) => ReactNode;
  word?: (index: number, children: ReactNode) => ReactNode;
}) {
  const render = { gap, word, words: 0 };
  return <>{doc.content?.map((n, i) => renderNode(n, i, render))}</>;
}

/** How one document renders its gap and word nodes, and how many words it has met so far. */
interface Render {
  gap?: (id: string) => ReactNode;
  word?: (index: number, children: ReactNode) => ReactNode;
  words: number;
}

function renderNode(node: RichNode, key: number, render: Render): ReactNode {
  const children = node.content?.map((n, i) => renderNode(n, i, render));
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
    case "codeBlock":
      return (
        <CodeView
          key={key}
          code={node.content?.map((c) => c.text).join("") ?? ""}
          language={node.attrs?.language}
        />
      );
    case "table":
      return (
        <div key={key} className="k-table">
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{children}</tr>;
    case "tableHeader":
      return (
        <th
          key={key}
          colSpan={node.attrs?.colspan}
          rowSpan={node.attrs?.rowspan}
        >
          {children}
        </th>
      );
    case "tableCell":
      return (
        <td
          key={key}
          colSpan={node.attrs?.colspan}
          rowSpan={node.attrs?.rowspan}
        >
          {children}
        </td>
      );
    case "image":
      return node.attrs?.src ? (
        <MediaImage
          key={key}
          src={node.attrs.src}
          w={node.attrs.w}
          h={node.attrs.h}
        />
      ) : null;
    case "audio":
      return node.attrs?.src ? (
        <RichAudio key={key} src={node.attrs.src} />
      ) : null;
    case "math":
      return node.attrs?.latex ? (
        <MathView key={key} latex={node.attrs.latex} />
      ) : null;
    case "gap":
      return node.attrs?.id && render.gap ? (
        <Fragment key={key}>{render.gap(node.attrs.id)}</Fragment>
      ) : null;
    case "word":
      return (
        <Fragment key={key}>
          {render.word ? render.word(render.words++, children) : children}
        </Fragment>
      );
    default:
      return <Fragment key={key}>{children ?? node.text}</Fragment>;
  }
}

/**
 * The picture for media `src` at its size in pixels `w`×`h`, scaled down by
 * the page's styles to fit the sheet. Its box has its final size from the
 * first frame, so layout measured before the file decodes stays right. When
 * it fails to load, such as offline
 * before it was preloaded, it shows a note and tries again once the URL
 * changes.
 */
export function MediaImage({
  src,
  w,
  h,
  className = "k-img",
}: {
  src: string;
  w?: number;
  h?: number;
  className?: string;
}) {
  const url = useMediaURL(src);
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === url) {
    return <span className="k-media-wait">{m.media_image_wait()}</span>;
  }
  const box =
    w && h
      ? ({
          aspectRatio: `${w} / ${h}`,
          "--img-w": `${w}px`,
          "--img-r": w / h,
        } as CSSProperties)
      : undefined;
  return (
    <img
      className={className}
      style={box}
      src={url}
      width={w}
      height={h}
      alt=""
      onError={() => setFailed(url)}
    />
  );
}

function RichAudio({ src }: { src: string }) {
  return <AudioPlayer src={useMediaURL(src)} />;
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
    case "code":
      return <code className="k-code">{inner}</code>;
    default:
      return inner;
  }
}
