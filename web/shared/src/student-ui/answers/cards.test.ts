import { expect, test } from "vitest";
import { invert, place } from "./cards";

test("place swaps a full slot", () => {
  expect(place({ a: "s1" }, "b", "s1", { s1: 1 })).toEqual({ b: "s1" });
  expect(place({ a: "g1" }, "b", "g1", { g1: Infinity })).toEqual({
    a: "g1",
    b: "g1",
  });
  expect(place({ a: "s1" }, "a", null, { s1: 1 })).toEqual({});
});

test("place moves a card out of its old slot", () => {
  expect(place({ a: "s1", b: "s2" }, "a", "s2", { s1: 1, s2: 1 })).toEqual({
    a: "s2",
  });
  expect(place({ a: "s1" }, "a", "s1", { s1: 1 })).toEqual({ a: "s1" });
});

test("invert swaps keys and values", () => {
  expect(invert({ g1: "w1", g2: "w2" })).toEqual({ w1: "g1", w2: "g2" });
});
