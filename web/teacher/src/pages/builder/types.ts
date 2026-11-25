import { m } from "@klats/shared/paraglide/messages.js";
import type { Locale } from "@klats/shared/paraglide/runtime.js";
import type { TypeGroup } from "@klats/shared/questionTypes.ts";
import type { IconName } from "../../ui/icons";

/*
 * What the builder knows about each question type: its name and description
 * in the picker, the example an empty question text shows, and which parts
 * of a question each has (the sets follow internal/testfmt's types.go, except
 * where a set's doc says otherwise).
 */

/**
 * The name and one-line description of each question type, in the UI
 * language unless `options.locale` names another, and the example question
 * text that fits the type.
 */
export const TYPE_INFO: Record<
  string,
  {
    name: (inputs?: object, options?: { locale?: Locale }) => string;
    desc: () => string;
    example: () => string;
  }
> = {
  single: {
    name: m.answer_single,
    desc: m.type_single_desc,
    example: m.builder_question_placeholder_single,
  },
  multi: {
    name: m.answer_multi,
    desc: m.type_multi_desc,
    example: m.builder_question_placeholder_multi,
  },
  truefalse: {
    name: m.type_truefalse_name,
    desc: m.type_truefalse_desc,
    example: m.builder_question_placeholder_truefalse,
  },
  grid: {
    name: m.type_grid_name,
    desc: m.type_grid_desc,
    example: m.builder_question_placeholder_grid,
  },
  short: {
    name: m.type_short_name,
    desc: m.type_short_desc,
    example: m.builder_question_placeholder_short,
  },
  number: {
    name: m.type_number_name,
    desc: m.type_number_desc,
    example: m.builder_question_placeholder_number,
  },
  gaps: {
    name: m.type_gaps_name,
    desc: m.type_gaps_desc,
    example: m.builder_question_placeholder_gaps,
  },
  order: {
    name: m.type_order_name,
    desc: m.type_order_desc,
    example: m.builder_question_placeholder_order,
  },
  match: {
    name: m.type_match_name,
    desc: m.type_match_desc,
    example: m.builder_question_placeholder_match,
  },
  groups: {
    name: m.type_groups_name,
    desc: m.type_groups_desc,
    example: m.builder_question_placeholder_groups,
  },
  bank: {
    name: m.type_bank_name,
    desc: m.type_bank_desc,
    example: m.builder_question_placeholder_bank,
  },
  hotspot: {
    name: m.type_hotspot_name,
    desc: m.type_hotspot_desc,
    example: m.builder_question_placeholder_hotspot,
  },
  label: {
    name: m.type_label_name,
    desc: m.type_label_desc,
    example: m.builder_question_placeholder_label,
  },
  highlight: {
    name: m.type_highlight_name,
    desc: m.type_highlight_desc,
    example: m.builder_question_placeholder_highlight,
  },
  open: {
    name: m.type_open_name,
    desc: m.type_open_desc,
    example: m.builder_question_placeholder_open,
  },
};

/** The heading of each group of question types in the picker. */
export const GROUP_NAMES: Record<TypeGroup, () => string> = {
  choice: m.type_group_choice,
  input: m.type_group_input,
  arrange: m.type_group_arrange,
  image: m.type_group_image,
  text: m.type_group_text,
  open: m.type_group_open,
};

/** Returns the icon of question type `type`. */
export const typeIcon = (type: string) => type as IconName;

/** The types whose questions have options. */
export const HAS_OPTIONS = new Set([
  "single",
  "multi",
  "truefalse",
  "grid",
  "order",
  "match",
  "groups",
  "bank",
  "label",
]);

/** The types whose options carry `correct`. */
export const HAS_CORRECT = new Set(["single", "multi", "truefalse"]);

/**
 * The types whose targets, and the options' choice of one, carry over in a
 * conversion: columns, right-hand sides and groups. A label's points do not.
 */
export const HAS_TARGETS = new Set(["grid", "match", "groups"]);

/** The types whose question has a body below its text. */
export const HAS_BODY = new Set(["gaps", "bank", "highlight"]);

/** The types whose question has an image of its own. */
export const HAS_IMAGE = new Set(["hotspot", "label"]);

/** The types that shuffle their options for each student, at the teacher's choice. */
export const HAS_SHUFFLE = new Set(["single", "multi", "truefalse", "grid"]);

/** The types that score each part, at the teacher's choice. */
export const HAS_PARTIAL = new Set([
  "multi",
  "truefalse",
  "grid",
  "gaps",
  "order",
  "match",
  "groups",
  "bank",
  "label",
  "highlight",
]);

/** The one-line hint under «Частковий бал» for each type that has it. */
export const PARTIAL_HINTS: Record<string, () => string> = {
  multi: m.builder_partial_hint,
  truefalse: m.builder_partial_hint_truefalse,
  grid: m.builder_partial_hint_grid,
  gaps: m.builder_partial_hint_gaps,
  order: m.builder_partial_hint_order,
  match: m.builder_partial_hint_match,
  groups: m.builder_partial_hint_groups,
  bank: m.builder_partial_hint_bank,
  label: m.builder_partial_hint_label,
  highlight: m.builder_partial_hint_highlight,
};
