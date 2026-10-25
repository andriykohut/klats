import type { Problem } from "@klats/shared/generated/testfmt.ts";
import { expect, test } from "vitest";
import { problemText } from "./Checks";

/** Every code of Test.Problems with the types that raise it, and whether it carries a Count. */
const CODES: { code: string; types: string[]; count?: number }[] = [
  {
    code: "no_text",
    types: [
      "single",
      "multi",
      "truefalse",
      "grid",
      "short",
      "number",
      "order",
      "match",
      "groups",
      "hotspot",
      "label",
      "open",
    ],
  },
  { code: "no_body", types: ["gaps", "bank", "highlight"] },
  { code: "no_correct", types: ["single", "multi"] },
  {
    code: "too_few_options",
    types: ["single", "multi", "order", "match", "groups"],
    count: 3,
  },
  { code: "too_few_options", types: ["truefalse", "grid"], count: 1 },
  { code: "single_many_correct", types: ["single"], count: 4 },
  {
    code: "empty_option",
    types: [
      "single",
      "multi",
      "truefalse",
      "grid",
      "order",
      "match",
      "groups",
      "bank",
      "label",
    ],
  },
  { code: "weak_partial", types: ["multi"] },
  { code: "too_few_targets", types: ["grid", "groups"], count: 2 },
  { code: "no_target", types: ["grid", "match", "groups"] },
  { code: "no_accepted", types: ["short"] },
  { code: "one_accepted", types: ["short"] },
  { code: "no_number", types: ["number"] },
  { code: "no_gaps", types: ["gaps", "bank"] },
  { code: "gap_no_answer", types: ["gaps", "bank"], count: 7 },
  { code: "no_image", types: ["hotspot", "label"] },
  { code: "no_areas", types: ["hotspot"] },
  { code: "no_points", types: ["label"] },
  { code: "point_no_label", types: ["label"], count: 9 },
  { code: "no_words", types: ["highlight"] },
];

test("problemText words every code for every type that raises it", () => {
  for (const { code, types, count } of CODES) {
    for (const type of types) {
      const p: Problem = { questionId: "q", code, severity: "error", count };
      const text = problemText(p, 5, type);
      expect(text, `${code} for ${type}`).not.toBe(code);
      expect(text, `${code} for ${type}`).toContain("5");
      if (count) expect(text, `${code} for ${type}`).toContain(String(count));
    }
  }
});

test("problemText reads an unknown code as the code", () => {
  const p: Problem = { questionId: "q", code: "new_code", severity: "error" };
  expect(problemText(p, 1, "single")).toBe("new_code");
});
