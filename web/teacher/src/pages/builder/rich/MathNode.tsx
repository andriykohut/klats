import { MathView } from "@klats/shared/math/MathView.tsx";
import {
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";

/**
 * A formula inside a line of text, stored as `{type: "math", attrs: {latex}}`.
 * It is an atom: the caret skips over it, and RichField reopens the formula
 * dialog when it is clicked. A custom node for the same reason as
 * {@link ImageNode}, and likewise parsed only from markup this editor wrote.
 */
export const MathNode = Node.create({
  name: "math",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex") ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-klats-math]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-klats-math": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});

function MathNodeView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" className="b-math" contentEditable={false}>
      <MathView latex={node.attrs.latex} />
    </NodeViewWrapper>
  );
}
