import { expect, test } from "vitest";
import { lowlight } from "./lowlight";
import { CODE_LANGUAGES } from "./registry";

test("the python grammar marks keywords", () => {
  expect(lowlight.highlight("python", "def f():").children[0]).toMatchObject({
    type: "element",
    properties: { className: ["hljs-keyword"] },
    children: [{ type: "text", value: "def" }],
  });
});

test("every code language has a grammar under its id", () => {
  for (const l of CODE_LANGUAGES) {
    expect(lowlight.registered(l.id), l.id).toBe(true);
  }
});
