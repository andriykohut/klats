import { expect, test } from "vitest";
import {
  formatDate,
  formatPoints,
  initials,
  padCells,
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
  const cases: [string[], ReturnType<typeof tally>][] = [
    [
      ["correct", "wrong", "current", "empty", "correct"],
      { good: 2, bad: 1, answered: 0, left: 2 },
    ],
    [
      ["full", "partial", "zero", "empty"],
      { good: 1, bad: 2, answered: 0, left: 1 },
    ],
    [
      ["answered", "answered", "current"],
      { good: 0, bad: 0, answered: 2, left: 1 },
    ],
    // A pending cell counts as left.
    [["full", "pending"], { good: 1, bad: 0, answered: 0, left: 1 }],
    [
      ["correct", "pending", "pending"],
      { good: 1, bad: 0, answered: 0, left: 2 },
    ],
    // An absent cell, a question the student did not get, is left out.
    [
      ["correct", "absent", "empty", "absent"],
      { good: 1, bad: 0, answered: 0, left: 1 },
    ],
  ];
  for (const [states, want] of cases) {
    expect(tally(states), states.join(" ")).toEqual(want);
  }
});

test("padCells fills a short row with absent cells", () => {
  expect(padCells([{ state: "correct" }], 3)).toEqual([
    { state: "correct" },
    { state: "absent" },
    { state: "absent" },
  ]);
  expect(padCells([{ state: "correct" }], 1)).toEqual([{ state: "correct" }]);
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
