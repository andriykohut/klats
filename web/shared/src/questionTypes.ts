import { m } from "./paraglide/messages.js";

/** How the type picker groups question types. */
export type TypeGroup =
  | "choice"
  | "input"
  | "arrange"
  | "image"
  | "text"
  | "open";

/** Every question type, in the type picker's order. */
export const QUESTION_TYPES: { type: string; group: TypeGroup }[] = [
  { type: "single", group: "choice" },
  { type: "multi", group: "choice" },
  { type: "truefalse", group: "choice" },
  { type: "grid", group: "choice" },
  { type: "short", group: "input" },
  { type: "number", group: "input" },
  { type: "order", group: "arrange" },
  { type: "match", group: "arrange" },
  { type: "groups", group: "arrange" },
  { type: "hotspot", group: "image" },
  { type: "label", group: "image" },
  { type: "gaps", group: "text" },
  { type: "bank", group: "text" },
  { type: "highlight", group: "text" },
  { type: "open", group: "open" },
];

const CHIPS: Record<string, () => string> = {
  single: m.answer_single,
  multi: m.answer_multi,
  truefalse: m.answer_truefalse,
  grid: m.answer_grid,
  short: m.answer_short,
  number: m.answer_number,
  gaps: m.answer_gaps,
  order: m.answer_order,
  match: m.answer_match,
  groups: m.answer_groups,
  bank: m.answer_bank,
  hotspot: m.answer_hotspot,
  label: m.answer_label,
  highlight: m.answer_highlight,
  open: m.answer_open,
};

/** Returns the label on the student sheet's chip, which says how to answer a question of `type`. */
export function chipText(type: string): string {
  return CHIPS[type]();
}
