import { m } from "@klats/shared/paraglide/messages.js";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Label,
  Modal,
  ModalOverlay,
  TextArea,
  TextField,
} from "react-aria-components";
import { useParse } from "../api/queries";
import { Icon } from "../ui/icons";

/** «Вставити список»: a dialog whose «Додати» hands the pasted names to `onAdd`. */
export function PasteDialog({ onAdd }: { onAdd: (names: string[]) => void }) {
  return (
    <DialogTrigger>
      <Button className="t-btn" data-variant="quiet">
        <Icon name="paste" />
        {m.classes_paste_open()}
      </Button>
      <ModalOverlay isDismissable className="t-scrim">
        <Modal className="t-modal">
          <Dialog className="t-dialog t-paste-dialog">
            {({ close }) => (
              <PasteForm
                onAdd={(names) => {
                  onAdd(names);
                  close();
                }}
              />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

/** Returns `value` once it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * A paste box and, beside it, the names the server finds in the paste, in
 * paste order, as the teacher types. «Додати» waits until the preview has
 * caught up with the text.
 */
function PasteForm({ onAdd }: { onAdd: (names: string[]) => void }) {
  const [text, setText] = useState("");
  const settled = useSettled(text, 300);
  const parse = useParse(settled);
  const behind = settled !== text || parse.isFetching;
  const failed = parse.isError && !behind;
  const names = text.trim() === "" || failed ? [] : (parse.data?.names ?? []);
  // «Додати» acts once: a double-click must not append the names twice.
  const added = useRef(false);
  return (
    <>
      <Heading slot="title">{m.classes_paste_open()}</Heading>
      <div className="t-paste">
        <TextField
          className="t-field t-paste-box"
          value={text}
          onChange={setText}
          autoFocus
        >
          <Label>{m.classes_paste()}</Label>
          <TextArea spellCheck={false} />
        </TextField>
        <div className="t-preview">
          {failed ? (
            <p className="t-field-error" role="alert">
              {m.classes_paste_failed()}
            </p>
          ) : (
            <p className="t-found" aria-live="polite">
              <b>{names.length}</b> {m.classes_found({ count: names.length })}
            </p>
          )}
          {names.length > 0 ? (
            <ol>
              {names.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ol>
          ) : (
            !failed && <p className="t-hint">{m.classes_paste_hint()}</p>
          )}
        </div>
      </div>
      <div className="t-dialog-actions">
        <Button slot="close" className="t-btn" data-variant="quiet">
          {m.action_cancel()}
        </Button>
        <Button
          className="t-btn"
          data-variant="primary"
          isDisabled={behind || names.length === 0}
          onPress={() => {
            if (added.current) return;
            added.current = true;
            onAdd(names);
          }}
        >
          {m.classes_paste_add()}
        </Button>
      </div>
    </>
  );
}
