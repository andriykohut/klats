import { expect, test } from "vitest";
import {
  formatDate,
  formatPoints,
  initials,
  shortName,
  tally,
} from "./journal";

test("initials keep the first letter of every part of a name", () => {
  expect(initials("Шевченко Олег")).toBe("Ш. О.");
  expect(initials("  Ґудзь   Тарас Іванович ")).toBe("Ґ. Т. І.");
  expect(initials("Їжак")).toBe("Ї.");
  expect(initials("")).toBe("");
});

test("a short name keeps the surname and the first name's initial", () => {
  expect(shortName("Бондар Олена")).toBe("Бондар О.");
  expect(shortName("Бондар")).toBe("Бондар");
  expect(shortName("Ткачук Святослав Петрович")).toBe("Ткачук С.");
});

test("a tally counts good, bad and answered cells and what is left", () => {
  expect(tally(["correct", "wrong", "current", "empty", "correct"])).toEqual({
    good: 2,
    bad: 1,
    answered: 0,
    left: 2,
  });
  expect(tally(["full", "partial", "zero", "empty"])).toEqual({
    good: 1,
    bad: 2,
    answered: 0,
    left: 1,
  });
  expect(tally(["answered", "answered", "current"])).toEqual({
    good: 0,
    bad: 0,
    answered: 2,
    left: 1,
  });
});

test("a tally counts a pending cell as left", () => {
  expect(tally(["full", "pending"]).left).toBe(1);
  expect(tally(["correct", "pending", "pending"])).toEqual({
    good: 1,
    bad: 0,
    answered: 0,
    left: 2,
  });
});

test("a tally leaves out the questions a student did not get", () => {
  expect(tally(["correct", "absent", "empty", "absent"])).toEqual({
    good: 1,
    bad: 0,
    answered: 0,
    left: 1,
  });
});

test("points show up to two decimals in the UI language", () => {
  expect(formatPoints(1, "uk")).toBe("1");
  expect(formatPoints(0.5, "uk")).toBe("0,5");
  expect(formatPoints(2 / 3, "uk")).toBe("0,67");
  expect(formatPoints(1.5, "en")).toBe("1.5");
});

test("a date names its year only when it is not this year's", () => {
  const now = new Date(2026, 9, 23).getTime();
  const day = { day: "numeric", month: "long" } as const;
  const thisYear = formatDate(new Date(2026, 0, 12).getTime(), "uk", day, now);
  const lastYear = formatDate(new Date(2025, 0, 12).getTime(), "uk", day, now);
  expect(thisYear).toBe("12 січня");
  expect(lastYear).toContain("2025");
  expect(lastYear).toContain("12 січня");
});
