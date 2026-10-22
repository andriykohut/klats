import { expect, test } from "vitest";
import { keyToOption } from "./keyboard";

test("keyToOption", () => {
  expect(keyToOption("3", 4)).toBe(2);
  expect(keyToOption("В", 4)).toBe(2);
  expect(keyToOption("є", 9)).toBe(6);
  expect(keyToOption("5", 4)).toBeNull();

  expect(keyToOption("1", 1)).toBe(0);
  expect(keyToOption("9", 9)).toBe(8);
  expect(keyToOption("а", 9)).toBe(0);
  expect(keyToOption("З", 9)).toBe(8);
  expect(keyToOption("0", 9)).toBeNull();
  expect(keyToOption("10", 12)).toBeNull();
  expect(keyToOption("Ґ", 9)).toBeNull();
  expect(keyToOption("ґ", 9)).toBeNull();
  // Latin look-alikes of А and В.
  expect(keyToOption("A", 9)).toBeNull();
  expect(keyToOption("B", 9)).toBeNull();
  expect(keyToOption("Enter", 9)).toBeNull();
  expect(keyToOption("1", 0)).toBeNull();
});
