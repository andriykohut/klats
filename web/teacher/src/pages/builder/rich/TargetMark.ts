import { Mark, mergeAttributes } from "@tiptap/react";

/**
 * The mark on the characters of a highlight body that the student has to
 * find, stored as `{type: "target"}` on a text node. A word counts as marked
 * when any of its characters is, so the mark may cover part of a word. It is
 * drawn as a tangerine underlay, and typing at its end does not extend it.
 * Only a marked {@link RichField} has it, and its shortcut (Mod-K) lives
 * there, where it reads the selection the teacher sees. A custom mark for the
 * same reason as {@link GapNode}, and likewise parsed only from markup this
 * editor wrote.
 */
export const TargetMark = Mark.create({
  name: "target",
  inclusive: false,

  parseHTML() {
    return [{ tag: "span[data-klats-target]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-klats-target": "",
        class: "b-target",
      }),
      0,
    ];
  },
});
