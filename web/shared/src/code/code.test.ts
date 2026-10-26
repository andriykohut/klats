import { expect, test } from "vitest";
import type { StudentTest } from "../generated/wire";
import { contrast, PALETTES } from "../palettes";
import { hasCode, TOKEN_COLOURS } from "./registry";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const code = (language?: string) => ({
  type: "codeBlock",
  attrs: language ? { language } : undefined,
  content: [{ type: "text", text: "x" }],
});

/** A one-question test with the extra fields of `q`. */
const one = (q: object): StudentTest =>
  ({
    title: "t",
    palette: "teal",
    navigation: "free",
    questions: [{ id: "q1", type: "single", text: doc(), options: [], ...q }],
  }) as StudentTest;

test("token colours meet contrast on every palette's code background", () => {
  for (const [token, colour] of Object.entries(TOKEN_COLOURS)) {
    for (const [id, p] of Object.entries(PALETTES)) {
      expect(
        contrast(colour, p.soft),
        `${token} on ${id}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("hasCode needs a code block with a language", () => {
  expect(hasCode(one({ text: doc(code()) }))).toBe(false);
  expect(hasCode(one({ text: doc(code("python")) }))).toBe(true);
  expect(hasCode(one({ body: doc(code("css")) }))).toBe(true);
  const option = { id: "o", content: doc(code("cpp")) };
  expect(hasCode(one({ options: [option] }))).toBe(true);
});
