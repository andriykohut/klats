import { expect, test } from "vitest";
import { insertSnippet, nextHole } from "./formula";

test("insertSnippet", () => {
  expect(insertSnippet("x+", 2, 2, "\\frac{}{}")).toEqual({
    latex: "x+\\frac{}{}",
    caret: 8,
  });
  expect(insertSnippet("ab", 0, 2, "\\sqrt{}")).toEqual({
    latex: "\\sqrt{ab}",
    caret: 9,
  });
  expect(insertSnippet("", 0, 0, "\\pi")).toEqual({ latex: "\\pi", caret: 3 });
  expect(insertSnippet("ab", 0, 2, "\\frac{}{}")).toEqual({
    latex: "\\frac{ab}{}",
    caret: 10,
  });
});

test("nextHole", () => {
  expect(nextHole("\\frac{1}{}", 7)).toBe(9);
  expect(nextHole("x^{2}+1", 4)).toBe(5);
  expect(nextHole("x+1", 1)).toBeNull();
});
