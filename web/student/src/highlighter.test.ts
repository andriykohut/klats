import { getHighlighter } from "@klats/shared/code/registry.ts";
import { expect, test } from "vitest";
import "./highlighter";

test("the python grammar marks keywords", () => {
  const tree = getHighlighter()?.("def f():", "python");
  const keyword = tree?.children[0];
  expect(keyword?.properties?.className).toEqual(["hljs-keyword"]);
  expect(keyword?.children?.[0].value).toBe("def");
});

test("every code language has a grammar", () => {
  for (const id of ["python", "cpp", "pascal", "javascript", "html", "css"]) {
    expect(() => getHighlighter()?.("", id)).not.toThrow();
  }
});
