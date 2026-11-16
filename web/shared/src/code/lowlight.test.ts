import { expect, test } from "vitest";
import { lowlight } from "./lowlight";
import { CODE_LANGUAGES } from "./registry";

test("every code language has a grammar under its id", () => {
  for (const l of CODE_LANGUAGES) {
    expect(lowlight.registered(l.id), l.id).toBe(true);
  }
});
