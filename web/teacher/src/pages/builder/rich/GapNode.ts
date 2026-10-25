import { m } from "@klats/shared/paraglide/messages.js";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
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

/**
 * Returns `fragment` with a new id on every gap node whose id is in `taken`.
 * The new ids join `taken`.
 */
function renewTaken(fragment: Fragment, taken: Set<string>): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((n) => {
    if (n.type.name === "gap") {
      if (!taken.has(n.attrs.id)) {
        taken.add(n.attrs.id);
        out.push(n);
      } else {
        const id = newId();
        taken.add(id);
        out.push(n.type.create({ id }));
      }
    } else out.push(n.isLeaf ? n : n.copy(renewTaken(n.content, taken)));
  });
  return Fragment.fromArray(out);
}

const wordsKey = new PluginKey<Map<string, string>>("gapWords");

/**
 * Makes the chips of the gaps in `view` show the text in `words`, by gap id,
 * instead of their number. A gap with no entry keeps its number.
 */
export function setGapWords(view: EditorView, words: Map<string, string>) {
  view.dispatch(view.state.tr.setMeta(wordsKey, words));
}

/**
 * A blank in the text of a gaps question, stored as `{type: "gap", attrs:
 * {id}}`. It is an atom drawn as a chip numbered by its place in the text, or
 * showing its word once {@link setGapWords} gives it one, and named «Пропуск N»
 * for assistive technology (all set by a decoration, so they follow the text as
 * gaps are added, moved and removed), and the id links it to the entry in the
 * question's `gaps` or the word option of a bank that holds its answers.
 *
 * Ids are unique within the question and a question holds at most
 * {@link MAX_LIST} gaps, as internal/testfmt requires: the node refuses an edit
 * that would repeat an id or add a gap past the limit. A gap pasted in gets a
 * new id, and so starts without answers, only when a gap with its id is still
 * in the text (a copy pasted into the same question); a gap that was cut and
 * pasted, or moved by dragging, keeps its id. A custom node for the same reason
 * as {@link ImageNode}, and likewise parsed only from markup this editor wrote.
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
        key: wordsKey,
        state: {
          init: () => new Map<string, string>(),
          apply: (tr, words) => tr.getMeta(wordsKey) ?? words,
        },
        filterTransaction: (tr) => {
          if (!tr.docChanged) return true;
          const ids = gapIds(tr.doc);
          return ids.length <= MAX_LIST && new Set(ids).size === ids.length;
        },
        props: {
          decorations: (state) => {
            const chips: Decoration[] = [];
            state.doc.descendants((n, pos) => {
              if (n.type.name !== "gap") return;
              const number = chips.length + 1;
              const word = wordsKey.getState(state)?.get(n.attrs.id);
              chips.push(
                Decoration.node(pos, pos + n.nodeSize, {
                  role: "img",
                  "aria-label": m.gap_label({ number }),
                  "data-n": String(number),
                  ...(word ? { "data-word": word } : {}),
                }),
              );
            });
            return DecorationSet.create(state.doc, chips);
          },
          handlePaste: (view, _event, slice) => {
            // Gaps outside the selection stay, so their ids are taken.
            const { doc, selection } = view.state;
            const taken = new Set<string>();
            doc.descendants((n, pos) => {
              if (
                n.type.name === "gap" &&
                (pos + n.nodeSize <= selection.from || pos >= selection.to)
              ) {
                taken.add(n.attrs.id);
              }
            });
            if (!gapIds(slice.content).some((id) => taken.has(id))) {
              return false;
            }
            const fresh = new Slice(
              renewTaken(slice.content, taken),
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
