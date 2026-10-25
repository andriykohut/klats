import { MathView } from "@klats/shared/math/MathView.tsx";
import { m } from "@klats/shared/paraglide/messages.js";
import { type KeyboardEvent, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Group,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import { flushSync } from "react-dom";
import { latexBroken } from "../../../math";
import { insertSnippet, nextHole, PALETTE } from "./formula";
import "./formula.css";

/** The most LaTeX a formula may hold; internal/rich allows 1000 characters. */
const MAX_LATEX = 1000;

/**
 * «Формула»: a LaTeX field with a palette of buttons and a live preview.
 * `onSubmit` gets the LaTeX when the teacher presses the button or Enter,
 * which both stay unavailable while the field is empty or KaTeX can't read it.
 * `editing` names the button «Зберегти» instead of «Вставити».
 */
export function FormulaDialog(props: {
  latex: string;
  editing: boolean;
  onSubmit: (latex: string) => void;
  onClose: () => void;
}) {
  const [latex, setLatex] = useState(props.latex);
  const input = useRef<HTMLInputElement>(null);
  const broken = latexBroken(latex);
  const ready = latex.trim() !== "" && !broken;

  const insert = (snippet: string) => {
    const field = input.current;
    if (!field) return;
    const next = insertSnippet(
      latex,
      field.selectionStart ?? latex.length,
      field.selectionEnd ?? latex.length,
      snippet,
    );
    // The caret can only be set once the field holds the new text.
    flushSync(() => setLatex(next.latex));
    // A key press on a palette button focuses the button, not the field.
    field.focus();
    field.setSelectionRange(next.caret, next.caret);
  };

  // Tab walks through the braces of the formula; once none is left it moves
  // on to the buttons.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && ready) {
      e.preventDefault();
      props.onSubmit(latex);
    } else if (e.key === "Tab" && !e.shiftKey) {
      const at = nextHole(latex, e.currentTarget.selectionEnd ?? latex.length);
      if (at === null) return;
      e.preventDefault();
      // The dialog's focus scope would move focus on Tab all the same.
      e.stopPropagation();
      e.currentTarget.setSelectionRange(at, at);
    }
  };

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => open || props.onClose()}
      className="t-scrim"
    >
      <Modal className="t-modal">
        <Dialog className="t-dialog b-fx-dialog">
          <Heading slot="title">{m.rich_formula()}</Heading>
          <TextField className="t-field" value={latex} onChange={setLatex}>
            <Label>{m.formula_latex()}</Label>
            <Input
              ref={input}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_LATEX}
              onKeyDown={onKeyDown}
            />
          </TextField>
          <Group className="b-fx-keys" aria-label={m.formula_symbols()}>
            {PALETTE.map((key) => (
              <Button
                key={key.snippet}
                className="b-fx-key"
                // Keeps the caret and selection in the field.
                preventFocusOnPress
                onPress={() => insert(key.snippet)}
              >
                {key.caption}
              </Button>
            ))}
          </Group>
          <p className="b-fx-label">{m.formula_preview()}</p>
          <div className="b-fx-preview">
            {broken ? (
              <p className="t-field-error" role="alert">
                {m.formula_error()}
              </p>
            ) : (
              <MathView latex={latex} />
            )}
          </div>
          <div className="t-dialog-actions">
            <Button slot="close" className="t-btn" data-variant="quiet">
              {m.action_cancel()}
            </Button>
            <Button
              className="t-btn"
              data-variant="teal"
              isDisabled={!ready}
              onPress={() => props.onSubmit(latex)}
            >
              {props.editing ? m.action_save() : m.formula_insert()}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
