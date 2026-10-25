import { expect, test } from "vitest";
import { nudge } from "./point";

test("nudge moves by 0.02, or 0.1 with Shift, within the image", () => {
  expect(nudge({ x: 0.5, y: 0.5 }, "ArrowRight", false)).toEqual({
    x: 0.52,
    y: 0.5,
  });
  expect(nudge({ x: 0.5, y: 0.5 }, "ArrowUp", true)).toEqual({
    x: 0.5,
    y: 0.4,
  });
  expect(nudge({ x: 0.99, y: 0.5 }, "ArrowRight", true)).toEqual({
    x: 1,
    y: 0.5,
  });
  expect(nudge({ x: 0.01, y: 0.5 }, "ArrowLeft", false)).toEqual({
    x: 0,
    y: 0.5,
  });
  expect(nudge({ x: 0.5, y: 0.5 }, "a", false)).toBeNull();
});
