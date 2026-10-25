import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { mergeAttributes, Node } from "@tiptap/react";
import { MAX_LIST, newId } from "../model";

/** Returns the ids of the gap nodes under `node`, in document order. */
function gapIds(node: PMNode | Fragment): string[] {
  const ids: string[] = [];
  node.descendants((n) => {
    if (n.type.name === "gap") ids.push(n.attrs.id);
  });
  return ids;
}

/** Returns `fragment` with a new id on every gap node in it. */
function withNewIds(fragment: Fragment): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((n) => {
    if (n.type.name === "gap") out.push(n.type.create({ id: newId() }));
    else out.push(n.isLeaf ? n : n.copy(withNewIds(n.content)));
  });
  return Fragment.fromArray(out);
}

/**
 * A blank in the text of a gaps question, stored as `{type: "gap", attrs:
 * {id}}`. It is an atom drawn as a chip numbered by its place in the text
 * (a CSS counter in editors.css), and the id links it to the entry in the
 * question's `gaps` that holds its answers.
 *
 * Ids are unique within the question and a question holds at most
 * {@link MAX_LIST} gaps, as internal/testfmt requires: the node refuses an edit
 * that would repeat an id or add a gap past the limit. A gap pasted in, from
 * this question or another, gets a new id and so starts without answers; a gap
 * moved by dragging keeps its id. A custom node for the same reason as
 * {@link ImageNode}, and likewise parsed only from markup this editor wrote.
 */
export const GapNode = Node.create({
  name: "gap",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-id") ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-klats-gap]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-klats-gap": "",
        class: "b-gap",
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr) => {
          if (!tr.docChanged) return true;
          const ids = gapIds(tr.doc);
          return ids.length <= MAX_LIST && new Set(ids).size === ids.length;
        },
        props: {
          handlePaste: (view, _event, slice) => {
            if (gapIds(slice.content).length === 0) return false;
            const fresh = new Slice(
              withNewIds(slice.content),
              slice.openStart,
              slice.openEnd,
            );
            view.dispatch(
              view.state.tr
                .replaceSelection(fresh)
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste"),
            );
            return true;
          },
        },
      }),
    ];
  },
});
