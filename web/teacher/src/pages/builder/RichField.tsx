import { m } from "@klats/shared/paraglide/messages.js";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { type EditorState, NodeSelection, Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { Button, FileTrigger } from "react-aria-components";
import { flushSync } from "react-dom";
import { lowlight } from "../../code";
import { addImage, mediaMessage, uploadMedia } from "./media";
import {
  MAX_LIST,
  newId,
  oneParagraph,
  textDoc,
  toStored,
  trimmedRange,
} from "./model";
import { AudioNode } from "./rich/AudioNode";
import { CodeLanguageSelect } from "./rich/CodeLanguageSelect";
import { FormulaDialog } from "./rich/FormulaDialog";
import { GapNode, setGapWords } from "./rich/GapNode";
import { ImageNode } from "./rich/ImageNode";
import { MathNode } from "./rich/MathNode";

/*
 * StarterKit trimmed to internal/rich's schema: doc, paragraph, text,
 * hardBreak, the two lists and listItem, and codeBlock, with bold, italic and
 * code; Subscript, Superscript, the table nodes, the formula node and, in
 * block fields, the image and audio nodes are added beside it. Gapped fields
 * keep the inline set and add the gap node. Block fields swap StarterKit's
 * codeBlock for CodeBlockLowlight, which highlights the block and adds its
 * `language` attr.
 * Pasted content is parsed against this schema, so headings, quotes, links
 * and the like arrive as plain paragraphs and text. Undo, the drop cursor
 * and the gap cursor stay: they add no nodes.
 */
const BLOCK = {
  blockquote: false,
  heading: false,
  horizontalRule: false,
  link: false,
  strike: false,
  underline: false,
  trailingNode: false,
} as const;

/** The inline schema of an answer option: no lists, no code blocks. */
const INLINE = {
  ...BLOCK,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  listItem: false,
  listKeymap: false,
} as const;

// Table cells hold paragraphs only, as internal/rich requires.
const TABLE_EXTENSIONS = [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader.extend({ content: "paragraph+" }),
  TableCell.extend({ content: "paragraph+" }),
];

const BLOCK_EXTENSIONS = [
  StarterKit.configure({ ...BLOCK, codeBlock: false }),
  CodeBlockLowlight.configure({ lowlight }),
  Subscript,
  Superscript,
  ...TABLE_EXTENSIONS,
  ImageNode,
  AudioNode,
  MathNode,
];
const INLINE_EXTENSIONS = [
  StarterKit.configure(INLINE),
  Subscript,
  Superscript,
  MathNode,
];

const GAPPED_EXTENSIONS = [
  StarterKit.configure(INLINE),
  Subscript,
  Superscript,
  MathNode,
  GapNode,
];

const MARKS = [
  { mark: "bold", label: m.rich_bold, keys: "B", glyph: "B" },
  { mark: "italic", label: m.rich_italic, keys: "I", glyph: "I" },
  { mark: "subscript", label: m.rich_subscript, keys: ",", glyph: "x₂" },
  { mark: "superscript", label: m.rich_superscript, keys: ".", glyph: "x²" },
  { mark: "code", label: m.rich_code, keys: "E", glyph: "‹›" },
] as const;

/** Toolbar buttons that edit blocks; only block fields have them. */
const BLOCKS = [
  {
    key: "codeBlock",
    label: m.rich_code_block,
    glyph: "{ }",
    run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "table",
    label: m.rich_table,
    glyph: "▦",
    run: insertTable,
  },
] as const;

/** Toolbar buttons that edit the table holding the caret. */
const TABLE_EDITS = [
  {
    key: "addRowAfter",
    label: m.rich_row_below,
    glyph: "↓+",
  },
  {
    key: "addColumnAfter",
    label: m.rich_col_right,
    glyph: "→+",
  },
  { key: "deleteRow", label: m.rich_row_delete, glyph: "↓−" },
  { key: "deleteColumn", label: m.rich_col_delete, glyph: "→−" },
  { key: "deleteTable", label: m.rich_table_delete, glyph: "×" },
] as const;

/** Toolbar buttons that add a file; only block fields have them. */
const MEDIA = [
  {
    kind: "image",
    label: m.rich_image,
    glyph: "▣",
    accept: ["image/*"],
  },
  {
    kind: "audio",
    label: m.rich_audio,
    glyph: "♪",
    accept: [".mp3", ".m4a", ".ogg", ".wav"],
  },
] as const;

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";
const SHIFT = MAC ? "⇧" : "Shift+";

/**
 * A rich-text field holding a stored rich document. It reports every edit
 * through `onChange` in the stored shape (see {@link toStored}), and reads
 * `value` only when it mounts: key it by what it edits.
 *
 * `inline` makes it an answer option: one paragraph (a paste is joined into
 * it with hard breaks), no lists, Enter calls `onEnter`, and Backspace in an
 * empty field calls `onEmptyBackspace`; a held key calls them once. A small
 * toolbar with bold, italic, subscript, superscript and code floats over the
 * field while it has focus; the same marks are on Mod-B, Mod-I, Mod-, Mod-.
 * and Mod-E. A block field's toolbar also has a code block and a 3×3 table;
 * while the caret is in a code block it adds a select for the block's
 * language, and while the caret is in a table it adds buttons to add or
 * delete a row or column and to delete the table. Table cells hold
 * paragraphs only, and cells are never merged or split here. A block field
 * also takes images and audio: its toolbar has an image and an audio button,
 * and an image file pasted or dropped into it is uploaded and inserted at the
 * caret or drop point. The
 * node goes in only after the upload succeeds; a failure shows a message under
 * the field until the next edit or upload. Both kinds of field take formulas:
 * the toolbar's formula button, or Mod-Shift-L, opens a dialog for a new one,
 * or for the formula that is selected, and clicking a formula reopens it.
 * Each time `focus` changes to a number other than 0, the field takes focus
 * with the caret at the end.
 *
 * `gapped` makes it the body of a gaps question: paragraphs and formatting
 * like an option but with more than one paragraph, formulas, and gaps; it has
 * no lists, code, tables or media. Its toolbar's «Пропуск» button, or
 * Mod-Shift-G, puts a gap at the caret, or in place of the selected text
 * without the whitespace at the selection's ends, and the button is disabled
 * once the body holds {@link MAX_LIST} gaps. Before the node goes in, `onGap`
 * gets its new id and the text it replaces (empty without a selection).
 * `gapName` names the gap button instead of «Пропуск». The chips show the
 * text `gapWords` has for their id instead of their number.
 */
export function RichField(props: {
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  label: string;
  placeholder: string;
  inline?: boolean;
  gapped?: boolean;
  onGap?: (id: string, selected: string) => void;
  gapName?: string;
  gapWords?: Map<string, string>;
  focus?: number;
  onEnter?: () => void;
  onEmptyBackspace?: () => void;
}) {
  const inline = props.inline ?? false;
  const gapped = props.gapped ?? false;
  const block = !(inline || gapped);
  const focus = props.focus ?? 0;
  const [error, setError] = useState("");
  const [languageOpen, setLanguageOpen] = useState(false);
  // The open formula dialog: the position of the formula it edits, or null
  // for a new one at the selection.
  const [formula, setFormula] = useState<{
    pos: number | null;
    latex: string;
  } | null>(null);

  const add = async (view: EditorView, files: File[]) => {
    setError("");
    for (const file of files) {
      try {
        if (
          file.type.startsWith("audio/") ||
          /\.(mp3|m4a|ogg|wav)$/i.test(file.name)
        ) {
          insertMedia(view, "audio", { src: await uploadMedia(file) });
        } else {
          insertMedia(view, "image", { ...(await addImage(file)) });
        }
      } catch (err) {
        setError(mediaMessage(err));
        return;
      }
    }
  };

  const editor = useEditor({
    immediatelyRender: true,
    extensions: gapped
      ? GAPPED_EXTENSIONS
      : inline
        ? INLINE_EXTENSIONS
        : BLOCK_EXTENSIONS,
    // A stored empty document has no paragraph, which ProseMirror requires.
    content: props.value.content?.length ? props.value : textDoc(""),
    editorProps: {
      attributes: {
        class: "b-rich-input",
        role: "textbox",
        "aria-label": props.label,
        "aria-multiline": inline ? "false" : "true",
        "aria-placeholder": props.placeholder,
      },
      // Mod-Shift-L (formula) and, in a gapped field, Mod-Shift-G (gap), by
      // key position so they work in any keyboard layout.
      handleKeyDown: (view, e) => {
        const { selection } = view.state;
        if (
          !e.shiftKey ||
          e.altKey ||
          !(MAC ? e.metaKey : e.ctrlKey) ||
          selection.$from.parent.type.spec.code
        ) {
          return false;
        }
        if (e.code === "KeyG" && gapped) {
          e.preventDefault();
          putGap();
          return true;
        }
        if (e.code !== "KeyL") return false;
        e.preventDefault();
        setFormula(selectedFormula(view.state));
        return true;
      },
      handleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name !== "math") return false;
        setFormula({ pos: nodePos, latex: node.attrs.latex });
        return true;
      },
      transformPasted: inline
        ? (slice, view) => oneParagraph(slice, view.state.schema)
        : undefined,
      // A screenshot or copied picture has no text; a copy from a document
      // carries both, and the text is what the teacher meant.
      handlePaste: !block
        ? undefined
        : (view, event) => {
            const data = event.clipboardData;
            const files = [...(data?.files ?? [])];
            if (!files.length || data?.getData("text/plain")) return false;
            event.preventDefault();
            void add(view, files);
            return true;
          },
      handleDrop: !block
        ? undefined
        : (view, event, _slice, moved) => {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (moved || !files.length) return false;
            event.preventDefault();
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (at) {
              const $at = view.state.doc.resolve(at.pos);
              view.dispatch(view.state.tr.setSelection(Selection.near($at)));
            }
            void add(view, files);
            return true;
          },
    },
    onUpdate: ({ editor }) => {
      setError("");
      props.onChange(toStored(editor.getJSON()) as RichDoc);
    },
  });

  useLayoutEffect(() => {
    if (!focus) return;
    editor.commands.focus("end");
    // The command moves focus a frame later; a key typed sooner must land here.
    editor.view.focus();
  }, [focus, editor]);

  const words = props.gapWords;
  const wordsKey = JSON.stringify([...(words ?? [])]);
  useEffect(() => {
    if (words && !editor.isDestroyed) setGapWords(editor.view, words);
  }, [wordsKey, editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      empty: e.isEmpty,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      subscript: e.isActive("subscript"),
      superscript: e.isActive("superscript"),
      code: e.isActive("code"),
      codeBlock: e.isActive("codeBlock"),
      language:
        (e.getAttributes("codeBlock").language as string | null) ?? null,
      table: e.isActive("table"),
      gaps: gapped ? gapCount(e) : 0,
    }),
  });

  // Caught before ProseMirror sees them, and rendered at once, so the next
  // key already reaches the option that took focus. A held key acts once:
  // Backspace held past the start of a cleared option must not remove it
  // and then eat into the one above, and a held Enter adds one option.
  const onKey = (e: KeyboardEvent) => {
    const plain = !(e.shiftKey || e.altKey || e.ctrlKey || e.metaKey);
    let act: (() => void) | undefined;
    if (e.key === "Enter" && plain) act = props.onEnter;
    else if (e.key === "Backspace" && plain && editor.isEmpty) {
      act = props.onEmptyBackspace;
    }
    if (!act || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) flushSync(act);
  };

  const putFormula = (latex: string) => {
    const chain = editor.chain().focus();
    const pos = formula?.pos;
    if (pos == null) chain.insertContent({ type: "math", attrs: { latex } });
    else {
      chain.command(({ tr }) => {
        tr.setNodeAttribute(pos, "latex", latex);
        // The formula stays selected otherwise, and the next key replaces it.
        tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
        return true;
      });
    }
    chain.run();
    setFormula(null);
  };

  const putGap = () => {
    if (gapCount(editor) >= MAX_LIST) return;
    const live = liveRange(editor.view);
    const { from, to } = trimmedRange(editor.state.doc, live.from, live.to);
    const id = newId();
    props.onGap?.(id, editor.state.doc.textBetween(from, to, " ").trim());
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, { type: "gap", attrs: { id } })
      .run();
  };

  return (
    <>
      <div
        className="b-rich"
        data-inline={inline || undefined}
        onKeyDownCapture={inline ? onKey : undefined}
      >
        <EditorContent editor={editor} />
        {error && (
          <p className="b-rich-err" role="alert">
            {error}
          </p>
        )}
        {state.empty && (
          <span className="b-rich-ph" aria-hidden="true">
            {props.placeholder}
          </span>
        )}
        {/* The format, table, formula and gap buttons are out of the tab order:
          each has a shortcut, named in its title. The image and audio buttons
          and the code language select have none, so they stay in the tab
          order.
          While the select's list is open, focus is outside the field and the
          bar is kept shown for the list to anchor to. */}
        <div
          className="b-rich-bar"
          data-open={languageOpen || undefined}
          role="toolbar"
          aria-label={m.rich_toolbar()}
        >
          {MARKS.map((b) => (
            <button
              key={b.mark}
              type="button"
              tabIndex={-1}
              className="b-rich-btn"
              data-mark={b.mark}
              aria-pressed={state[b.mark]}
              aria-label={b.label()}
              title={`${b.label()} (${MOD}${b.keys})`}
              // Keeps the selection in the editor.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(editor, b.mark)}
            >
              {b.glyph}
            </button>
          ))}
          {block &&
            BLOCKS.map((b) => (
              <button
                key={b.key}
                type="button"
                tabIndex={-1}
                className="b-rich-btn"
                data-mark={b.key}
                aria-pressed={
                  b.key === "codeBlock" ? state.codeBlock : undefined
                }
                aria-label={b.label()}
                title={b.label()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => b.run(editor)}
              >
                {b.glyph}
              </button>
            ))}
          {block && state.codeBlock && (
            <CodeLanguageSelect
              value={state.language}
              onChange={(language) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("codeBlock", { language })
                  .run()
              }
              onOpenChange={setLanguageOpen}
            />
          )}
          {block &&
            MEDIA.map((b) => (
              <FileTrigger
                key={b.kind}
                acceptedFileTypes={b.accept}
                onSelect={(files) => void add(editor.view, [...(files ?? [])])}
              >
                <Button
                  className="b-rich-btn"
                  data-mark={b.kind}
                  aria-label={b.label()}
                  // Keeps the selection in the editor.
                  preventFocusOnPress
                >
                  {b.glyph}
                </Button>
              </FileTrigger>
            ))}
          <button
            type="button"
            tabIndex={-1}
            className="b-rich-btn"
            data-mark="math"
            aria-label={m.rich_formula()}
            title={`${m.rich_formula()} (${MOD}${SHIFT}L)`}
            disabled={state.codeBlock}
            // Keeps the selection in the editor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFormula(selectedFormula(editor.state))}
          >
            π
          </button>
          {gapped && (
            <button
              type="button"
              className="b-rich-btn"
              data-mark="gap"
              aria-label={props.gapName ?? m.rich_gap()}
              tabIndex={-1}
              title={`${props.gapName ?? m.rich_gap()} (${MOD}${SHIFT}G)`}
              disabled={state.gaps >= MAX_LIST}
              // Keeps the selection in the editor.
              onMouseDown={(e) => e.preventDefault()}
              onClick={putGap}
            >
              [ ]
            </button>
          )}
          {state.table &&
            TABLE_EDITS.map((b) => (
              <button
                key={b.key}
                type="button"
                tabIndex={-1}
                className="b-rich-btn"
                data-mark={b.key}
                aria-label={b.label()}
                title={b.label()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus()[b.key]().run()}
              >
                {b.glyph}
              </button>
            ))}
        </div>
      </div>
      {formula && (
        <FormulaDialog
          latex={formula.latex}
          editing={formula.pos !== null}
          onSubmit={putFormula}
          onClose={() => setFormula(null)}
        />
      )}
    </>
  );
}

/** The formula dialog's start: the selected formula, or a new one. */
function selectedFormula({ selection }: EditorState): {
  pos: number | null;
  latex: string;
} {
  return selection instanceof NodeSelection &&
    selection.node.type.name === "math"
    ? { pos: selection.from, latex: selection.node.attrs.latex }
    : { pos: null, latex: "" };
}

/**
 * Inserts a media block at the selection, splitting the paragraph the caret is
 * in. A block that would end the document gets an empty paragraph after it,
 * the only place to continue typing below it.
 */
function insertMedia(
  view: EditorView,
  type: "image" | "audio",
  attrs: Record<string, unknown>,
): void {
  if (view.isDestroyed) return;
  const { schema } = view.state;
  const tr = view.state.tr.replaceSelectionWith(
    schema.nodes[type].create(attrs),
  );
  if (MEDIA.some((b) => b.kind === tr.doc.lastChild?.type.name)) {
    tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
  }
  // The insertion leaves the block selected; the caret belongs below it.
  const below = Selection.findFrom(tr.doc.resolve(tr.selection.to), 1, true);
  if (below) tr.setSelection(below);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/**
 * Returns the range the teacher has selected in `view`. ProseMirror's own
 * selection follows the DOM's on an asynchronous `selectionchange` event, so
 * a shortcut pressed right after an arrow key would see the selection before
 * it; the DOM selection is read instead. A node selection, which the DOM shows
 * as a caret, and a view without focus keep ProseMirror's selection.
 */
function liveRange(view: EditorView): { from: number; to: number } {
  const { selection } = view.state;
  const dom = (view.root as Document).getSelection();
  if (
    selection instanceof NodeSelection ||
    !view.hasFocus() ||
    !dom?.anchorNode ||
    !dom.focusNode ||
    !view.dom.contains(dom.anchorNode) ||
    !view.dom.contains(dom.focusNode)
  ) {
    return { from: selection.from, to: selection.to };
  }
  const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
  const focus = view.posAtDOM(dom.focusNode, dom.focusOffset);
  return { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
}

/** Returns how many gap nodes `editor` holds. */
function gapCount(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "gap") n++;
  });
  return n;
}

function toggle(editor: Editor, mark: (typeof MARKS)[number]["mark"]): void {
  const chain = editor.chain().focus();
  if (mark === "bold") chain.toggleBold().run();
  else if (mark === "italic") chain.toggleItalic().run();
  else if (mark === "subscript") chain.toggleSubscript().run();
  else if (mark === "superscript") chain.toggleSuperscript().run();
  else chain.toggleCode().run();
}

/**
 * Inserts a 3×3 table with a header row at the caret. A table that would end
 * the document gets an empty paragraph after it, the only place to continue
 * typing below it.
 */
function insertTable(editor: Editor): void {
  editor
    .chain()
    .focus()
    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    .command(({ tr, state }) => {
      if (tr.doc.lastChild?.type.name === "table") {
        tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
      }
      return true;
    })
    .run();
}
