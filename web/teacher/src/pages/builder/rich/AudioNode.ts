import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { AudioView } from "./MediaViews";

/**
 * A recording between paragraphs, stored as `{type: "audio", attrs: {src}}`:
 * a media name. A custom node for the same reason as {@link ImageNode}, and
 * likewise parsed only from markup this editor wrote.
 */
export const AudioNode = Node.create({
  name: "audio",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-src") ?? "",
        renderHTML: (attrs) => ({ "data-src": attrs.src }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-klats-audio]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-klats-audio": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
});
