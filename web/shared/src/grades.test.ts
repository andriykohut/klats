import { expect, test } from "vitest";
import { averageText, gradeBand, gradeFill, gradeText } from "./grades";
import { m } from "./paraglide/messages.js";

test("gradeText formats a grade for its scale", () => {
  expect(gradeText("points12", 9)).toBe("9");
  expect(gradeText("percent", 87)).toBe("87%");
  expect(gradeText("pass", 1)).toBe(m.grade_pass());
  expect(gradeText("pass", 0)).toBe(m.grade_fail());
});

test("gradeBand puts a grade in an achievement level", () => {
  expect(gradeBand("points12", 10)).toBe("hi");
  expect(gradeBand("points12", 3)).toBe("min");
  expect(gradeBand("percent", 83)).toBe("hi");
  expect(gradeBand("percent", 82)).toBe("mid");
  expect(gradeBand("percent", 33)).toBe("lo");
  expect(gradeBand("percent", 32)).toBe("min");
  expect(gradeBand("pass", 1)).toBe("hi");
  expect(gradeBand("pass", 0)).toBe("min");
});

test("gradeFill is how full a grade is", () => {
  expect(gradeFill("points12", 6)).toBe(0.5);
  expect(gradeFill("percent", 87)).toBe(0.87);
  expect(gradeFill("pass", 1)).toBe(1);
  expect(gradeFill("pass", 0)).toBe(0);
});

test("averageText formats a mean for its scale", () => {
  expect(averageText("pass", 0.72, "uk")).toContain("72");
  expect(averageText("points12", 8.25, "en")).toBe("8.3");
  expect(averageText("percent", 87.5, "en")).toBe("87.5%");
});
