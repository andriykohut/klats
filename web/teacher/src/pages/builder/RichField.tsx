import { m } from "@klats/shared/paraglide/messages.js";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type KeyboardEvent, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { oneParagraph, textDoc, toStored } from "./model";

/*
 * StarterKit trimmed to internal/rich's schema: doc, paragraph, text,
 * hardBreak, the two lists and listItem, and codeBlock, with bold, italic and
 * code; Subscript, Superscript and the table nodes are added beside it.
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
  StarterKit.configure(BLOCK),
  Subscript,
  Superscript,
  ...TABLE_EXTENSIONS,
];
const INLINE_EXTENSIONS = [
  StarterKit.configure(INLINE),
  Subscript,
  Superscript,
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

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

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
 * while the caret is in a table it adds buttons to add or delete a row or
 * column and to delete the table. Table cells hold paragraphs only, and cells
 * are never merged or split here. Each time `focus` changes to a number other than 0, the field takes focus
 * with the caret at the end.
 */
export function RichField(props: {
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  label: string;
  placeholder: string;
  inline?: boolean;
  focus?: number;
  onEnter?: () => void;
  onEmptyBackspace?: () => void;
}) {
  const inline = props.inline ?? false;
  const focus = props.focus ?? 0;

  const editor = useEditor({
    immediatelyRender: true,
    extensions: inline ? INLINE_EXTENSIONS : BLOCK_EXTENSIONS,
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
      transformPasted: inline
        ? (slice, view) => oneParagraph(slice, view.state.schema)
        : undefined,
    },
    onUpdate: ({ editor }) =>
      props.onChange(toStored(editor.getJSON()) as RichDoc),
  });

  useLayoutEffect(() => {
    if (!focus) return;
    editor.commands.focus("end");
    // The command moves focus a frame later; a key typed sooner must land here.
    editor.view.focus();
  }, [focus, editor]);

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
      table: e.isActive("table"),
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

  return (
    <div
      className="b-rich"
      data-inline={inline || undefined}
      onKeyDownCapture={inline ? onKey : undefined}
    >
      <EditorContent editor={editor} />
      {state.empty && (
        <span className="b-rich-ph" aria-hidden="true">
          {props.placeholder}
        </span>
      )}
      {/* Out of the tab order: every button has a shortcut, named in its title. */}
      <div className="b-rich-bar" role="toolbar" aria-label={m.rich_toolbar()}>
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
        {!inline &&
          BLOCKS.map((b) => (
            <button
              key={b.key}
              type="button"
              tabIndex={-1}
              className="b-rich-btn"
              data-mark={b.key}
              aria-pressed={b.key === "codeBlock" ? state.codeBlock : undefined}
              aria-label={b.label()}
              title={b.label()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => b.run(editor)}
            >
              {b.glyph}
            </button>
          ))}
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
  );
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
