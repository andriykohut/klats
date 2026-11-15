import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale, type Locale } from "@klats/shared/paraglide/runtime.js";
import { useRef, useState } from "react";
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
import { notify } from "../../ui/Toasts";
import { withBold } from "../../ui/withBold";
import promptEn from "./paste-prompt.en.txt?raw";
import promptUk from "./paste-prompt.uk.txt?raw";
import {
  type PastedQuestion,
  parsePasted,
  type SkipReason,
} from "./pasteParse";
import { TYPE_INFO } from "./types";

/** What a teacher gives a chatbot so that it writes questions this box reads. */
const PROMPTS: Record<Locale, string> = { uk: promptUk, en: promptEn };

const REASONS: Record<SkipReason, () => string> = {
  line: m.paste_skip_line,
  type: m.paste_skip_type,
  picture: m.paste_skip_picture,
  empty: m.paste_skip_empty,
  number: m.paste_skip_number,
  points: m.paste_skip_points,
};

/**
 * «Вставити з тексту», or «Скласти з ШІ» when `ai` is set: a paste box that
 * shows, as the teacher types, the questions it reads, with their types and
 * answers, and the lines it leaves out and why; «Додати» hands the questions
 * to `onAdd`. With `ai`, a request field and a button above it copy the
 * chatbot prompt in the UI language, with the request at its end.
 */
export function PasteDialog({
  onAdd,
  ai = false,
}: {
  onAdd: (questions: PastedQuestion[]) => void;
  ai?: boolean;
}) {
  return (
    <DialogTrigger>
      <Button className="t-btn b-paste-btn" data-variant="quiet">
        <Icon name={ai ? "sparkle" : "paste"} />
        {ai ? m.builder_ai() : m.builder_paste()}
      </Button>
      <ModalOverlay isDismissable className="t-scrim">
        <Modal className="t-modal">
          <Dialog className="t-dialog b-paste-dialog">
            {({ close }) => (
              <PasteForm
                ai={ai}
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

function PasteForm({
  ai,
  onAdd,
}: {
  ai: boolean;
  onAdd: (qs: PastedQuestion[]) => void;
}) {
  const [text, setText] = useState("");
  const [request, setRequest] = useState("");
  const { questions: found, skipped } = parsePasted(text);
  // «Додати» acts once: a double-click must not add the questions twice.
  const added = useRef(false);
  const copyPrompt = () => {
    const prompt = request.trim()
      ? `${PROMPTS[getLocale()].trimEnd()} ${request.trim()}\n`
      : PROMPTS[getLocale()];
    navigator.clipboard.writeText(prompt).then(
      () => notify(m.ai_copied()),
      () => notify(m.error_server(), true),
    );
  };
  return (
    <>
      <Heading slot="title">{ai ? m.builder_ai() : m.builder_paste()}</Heading>
      {ai ? (
        <>
          <p>{m.ai_step_request()}</p>
          <div className="b-ai-request">
            <TextField
              className="t-field"
              value={request}
              onChange={setRequest}
              aria-label={m.ai_request_label()}
              autoFocus
            >
              <TextArea rows={2} placeholder={m.ai_request_placeholder()} />
            </TextField>
            <Button className="t-btn" data-variant="teal" onPress={copyPrompt}>
              <Icon name="copy" />
              {m.ai_copy()}
            </Button>
          </div>
          <p>{m.ai_step_reply()}</p>
        </>
      ) : (
        <p>{m.paste_text()}</p>
      )}
      <div className="b-paste">
        <TextField
          className="t-field b-paste-box"
          value={text}
          onChange={setText}
          aria-label={ai ? m.ai_reply_label() : m.paste_label()}
          autoFocus={!ai}
        >
          <TextArea
            spellCheck={false}
            placeholder={ai ? m.ai_reply_placeholder() : m.paste_placeholder()}
          />
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
                <span className="b-found-type">
                  {TYPE_INFO[q.question.type].name()}
                </span>
                <b>{q.title}</b>
                <ul>
                  {q.rows.map((r, j) => (
                    <li key={j} data-correct={r.correct || undefined}>
                      {r.text}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {skipped.length > 0 && (
            <div className="b-paste-skipped">
              <p className="b-found">
                {withBold(m.paste_skipped.parts({ count: skipped.length }))}
              </p>
              <ol className="b-skipped">
                {skipped.map((s, i) => (
                  <li key={i}>
                    <b>{s.line}</b>
                    <span>{REASONS[s.reason]()}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
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
