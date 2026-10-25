import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { type RichDoc, RichView } from "./RichView";

const word = (...content: object[]) => ({ type: "word", content });
const para = (...content: object[]) => ({ type: "paragraph", content });
const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length && { marks: marks.map((type) => ({ type })) }),
});

// What Go's rich.Doc.Words makes of «Кіт **біж**ить, м’ята й пів-яблука.»
// split over two paragraphs: five words, and the bold syllable stays a text
// node inside the word «біжить».
const doc = {
  type: "doc",
  content: [
    para(
      word(text("Кіт")),
      text(" "),
      word(text("біж", "bold"), text("ить")),
      text(","),
    ),
    para(
      word(text("м’ята")),
      text(" "),
      word(text("й")),
      text(" "),
      word(text("пів-яблука")),
      text("."),
    ),
  ],
} as RichDoc;

test("word numbers the word nodes through the whole document", () => {
  const html = renderToStaticMarkup(
    <RichView
      doc={doc}
      word={(i: number, children: ReactNode) => <b data-i={i}>{children}</b>}
    />,
  );
  expect(html).toBe(
    '<p><b data-i="0">Кіт</b> <b data-i="1"><strong>біж</strong>ить</b>,</p>' +
      '<p><b data-i="2">м’ята</b> <b data-i="3">й</b> <b data-i="4">пів-яблука</b>.</p>',
  );
});

test("a word renders its text without the prop", () => {
  expect(renderToStaticMarkup(<RichView doc={doc} />)).toBe(
    "<p>Кіт <strong>біж</strong>ить,</p><p>м’ята й пів-яблука.</p>",
  );
});
