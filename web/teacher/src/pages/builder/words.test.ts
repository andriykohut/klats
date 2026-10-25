import type { RichDoc, RichNode } from "@klats/shared/rich/RichView.tsx";
import { expect, test } from "vitest";
import { tokenize } from "./words";

const text = (t: string, ...marks: string[]): RichNode => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const doc = (...paragraphs: RichNode[][]): RichDoc => ({
  type: "doc",
  content: paragraphs.map((content) => ({ type: "paragraph", content })),
});

/** The text of every word node of `d`, in order. */
function words(d: RichDoc): string[] {
  const out: string[] = [];
  const walk = (n: RichNode): string => {
    if (n.type === "text") return n.text ?? "";
    const inner = (n.content ?? []).map(walk).join("");
    if (n.type === "word") out.push(inner);
    return inner;
  };
  d.content?.forEach(walk);
  return out;
}

test("tokenize matches the server's words", () => {
  const { doc: out, targets } = tokenize(
    doc([text("Кіт "), text("біж", "bold"), text("ить, м’ята й пів-яблука.")]),
  );
  expect(words(out)).toEqual(["Кіт", "біжить", "м’ята", "й", "пів-яблука"]);
  expect(targets).toEqual([]);
  const p = out.content?.[0].content ?? [];
  expect(p.map((n) => n.type).join(" ")).toBe(
    "word text word text word text word text word text",
  );
  expect(p[2].content).toEqual([text("біж", "bold"), text("ить")]);
});

test("tokenize applies the word rule of internal/rich", () => {
  const split = (...inline: RichNode[]) => words(tokenize(doc(inline)).doc);
  expect(split(text("'так' — ні--так -а б-"))).toEqual([
    "так",
    "ні",
    "так",
    "а",
    "б",
  ]);
  expect(split(text("x²+5 café 2026р."))).toEqual(["x", "5", "café", "2026р"]);
  expect(split(text("раз"), { type: "hardBreak" }, text("два"))).toEqual([
    "раз",
    "два",
  ]);
  // U+02BC is a letter, so it holds a word together even at its edge.
  expect(split(text("ʼя"))).toEqual(["ʼя"]);
  // A combining mark is part of its word.
  expect(split(text("ét"))).toEqual(["ét"]);
  expect(words(tokenize(doc([text("а")], [text("б")])).doc)).toEqual([
    "а",
    "б",
  ]);
});

test("tokenize lists the marked words and removes the mark, a partly marked word counting as marked", () => {
  const { doc: out, targets } = tokenize(
    doc(
      [text("Небо ", "target"), text("дуже яс"), text("не", "bold", "target")],
      [text("і ", "italic"), text("тепло", "target")],
    ),
  );
  expect(words(out)).toEqual(["Небо", "дуже", "ясне", "і", "тепло"]);
  expect(targets).toEqual([0, 2, 4]);
  expect(JSON.stringify(out)).not.toContain("target");
  expect(JSON.stringify(out)).toContain("italic");
});
