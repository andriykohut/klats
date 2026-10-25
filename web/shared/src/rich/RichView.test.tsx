import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { type RichDoc, RichView } from "./RichView";

const word = (text: string) => ({
  type: "word",
  content: [{ type: "text", text }],
});
const para = (...content: object[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });

// The server numbers words in document order with one counter (Go's
// rich.Doc.Words), so the second paragraph carries on from the first.
const doc = {
  type: "doc",
  content: [
    para(word("Сонце"), text(", "), word("вітер")),
    para(word("хмари")),
  ],
} as RichDoc;

test("word numbers the word nodes across paragraphs", () => {
  const html = renderToStaticMarkup(
    <RichView
      doc={doc}
      word={(i: number, children: ReactNode) => <b data-i={i}>{children}</b>}
    />,
  );
  expect(html).toBe(
    '<p><b data-i="0">Сонце</b>, <b data-i="1">вітер</b></p><p><b data-i="2">хмари</b></p>',
  );
});

test("a word renders its text without the prop", () => {
  expect(renderToStaticMarkup(<RichView doc={doc} />)).toBe(
    "<p>Сонце, вітер</p><p>хмари</p>",
  );
});
