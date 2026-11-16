import { expect, test } from "vitest";
import { place } from "./cards";

test("place moves a card out of its old slot and swaps a full one", () => {
  expect(place({ a: "s1" }, "b", "s1", { s1: 1 })).toEqual({ b: "s1" });
  expect(place({ a: "g1" }, "b", "g1", { g1: Infinity })).toEqual({
    a: "g1",
    b: "g1",
  });
  expect(place({ a: "s1" }, "a", null, { s1: 1 })).toEqual({});
  expect(place({ a: "s1", b: "s2" }, "a", "s2", { s1: 1, s2: 1 })).toEqual({
    a: "s2",
  });
  expect(place({ a: "s1" }, "a", "s1", { s1: 1 })).toEqual({ a: "s1" });
});
