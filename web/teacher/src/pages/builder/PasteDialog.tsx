import { m } from "@klats/shared/paraglide/messages.js";
import type { MessagePart } from "@klats/shared/paraglide/runtime.js";
import { type ReactNode, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  TextArea,
  TextField,
} from "react-aria-components";
import { Icon } from "../../ui/icons";
import { type PastedQuestion, parsePasted } from "./pasteParse";

/**
 * «Вставити з тексту»: a paste box that shows, as the teacher types, how many
 * questions it reads and what they are; «Додати» hands them to `onAdd`.
 */
export function PasteDialog({
  onAdd,
}: {
  onAdd: (questions: PastedQuestion[]) => void;
}) {
  return (
    <DialogTrigger>
      <Button className="t-btn b-paste-btn" data-variant="quiet">
        <Icon name="paste" />
        {m.builder_paste()}
      </Button>
      <ModalOverlay isDismissable className="t-scrim">
        <Modal className="t-modal">
          <Dialog className="t-dialog b-paste-dialog">
            {({ close }) => (
              <PasteForm
                onAdd={(qs) => {
                  onAdd(qs);
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

function PasteForm({ onAdd }: { onAdd: (qs: PastedQuestion[]) => void }) {
  const [text, setText] = useState("");
  const found = parsePasted(text);
  // «Додати» acts once: a double-click must not add the questions twice.
  const added = useRef(false);
  return (
    <>
      <Heading slot="title">{m.builder_paste()}</Heading>
      <p>{m.paste_text()}</p>
      <div className="b-paste">
        <TextField
          className="t-field b-paste-box"
          value={text}
          onChange={setText}
          aria-label={m.paste_label()}
          autoFocus
        >
          <TextArea spellCheck={false} placeholder={m.paste_placeholder()} />
        </TextField>
        <div className="b-paste-found">
          <p className="b-found" aria-live="polite">
            {found.length === 0 && text.trim()
              ? m.paste_none()
              : withBold(m.paste_found.parts({ count: found.length }))}
          </p>
          <ol>
            {found.map((q, i) => (
              <li key={i}>
                <b>{q.text}</b>
                <ul>
                  {q.options.map((o, j) => (
                    <li key={j} data-correct={o.correct || undefined}>
                      {o.text}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="t-dialog-actions">
        <Button slot="close" className="t-btn" data-variant="quiet">
          {m.action_cancel()}
        </Button>
        <Button
          className="t-btn"
          data-variant="teal"
          isDisabled={found.length === 0}
          onPress={() => {
            if (added.current) return;
            added.current = true;
            onAdd(found);
          }}
        >
          {found.length
            ? m.paste_add({ count: found.length })
            : m.classes_paste_add()}
        </Button>
      </div>
    </>
  );
}

/** Renders message parts, bolding each {#b}…{/b} span. */
function withBold(parts: MessagePart[]): ReactNode[] {
  let bold = false;
  return parts.map((part, i) => {
    if (part.type === "markup-start") bold = true;
    else if (part.type === "markup-end") bold = false;
    else if (part.type === "text") {
      return bold ? <b key={i}>{part.value}</b> : part.value;
    }
    return null;
  });
}
