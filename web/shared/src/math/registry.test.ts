import { expect, test } from "vitest";
import type { StudentTest } from "../generated/wire";
import { hasMath } from "./registry";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (s: string) => ({ type: "text", text: s });
const math = { type: "math", attrs: { latex: "\\frac{1}{2}" } };

/** A one-question test with the extra fields of `q`. */
const one = (q: object): StudentTest =>
  ({
    title: "t",
    palette: "teal",
    questions: [{ id: "q1", type: "single", text: doc(), options: [], ...q }],
  }) as StudentTest;

test("hasMath", () => {
  expect(hasMath(one({ text: doc(para(text("2+2"))) }))).toBe(false);
  expect(hasMath(one({ text: doc(para(text("a "), math)) }))).toBe(true);
  const option = (content: unknown) => ({ id: "o", content });
  expect(
    hasMath(
      one({ options: [option(doc(para(text("1")))), option(doc(para(math)))] }),
    ),
  ).toBe(true);
  expect(hasMath(one({ body: doc(para(math)) }))).toBe(true);
  expect(hasMath(one({ targets: [{ content: doc(para(math)) }] }))).toBe(true);
});
