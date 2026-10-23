import { expect, test } from "vitest";
import { cooldown } from "./cooldown";

test("lets one press through, then refuses presses for the cooldown", () => {
  let now = 1000;
  const allow = cooldown(400, () => now);
  expect(allow()).toBe(true);
  now += 1;
  expect(allow()).toBe(false);
  now += 398;
  expect(allow()).toBe(false);
  now += 1;
  expect(allow()).toBe(true);
});

test("a refused press does not extend the cooldown", () => {
  let now = 0;
  const allow = cooldown(400, () => now);
  allow();
  now = 300;
  expect(allow()).toBe(false);
  now = 400;
  expect(allow()).toBe(true);
});
