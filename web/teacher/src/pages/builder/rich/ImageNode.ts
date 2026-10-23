import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { ImageView } from "./MediaViews";

/**
 * A picture between paragraphs, stored as `{type: "image", attrs: {src, w,
 * h}}`: a media name and its size in pixels. It is a custom node, not
 * TipTap's image extension, because internal/rich rejects any other attr.
 * Only markup this editor wrote parses back into one, so an `<img>` pasted
 * from a web page never becomes an image node with a foreign `src`.
 */
export const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-src") ?? "",
        renderHTML: (attrs) => ({ "data-src": attrs.src }),
      },
      w: {
        default: 1,
        parseHTML: (el) => Number(el.getAttribute("data-w")) || 1,
        renderHTML: (attrs) => ({ "data-w": attrs.w }),
      },
      h: {
        default: 1,
        parseHTML: (el) => Number(el.getAttribute("data-h")) || 1,
        renderHTML: (attrs) => ({ "data-h": attrs.h }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-klats-image]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-klats-image": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
