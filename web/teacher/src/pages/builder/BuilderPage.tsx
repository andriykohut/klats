import type { Question, Test } from "@klats/shared/generated/testfmt.ts";
import type { SaveResult, TestDoc } from "@klats/shared/generated/wire.ts";
import { PALETTES, type PaletteId } from "@klats/shared/palettes.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Input,
  Label,
  RadioButton,
  RadioField,
  RadioGroup,
  TextField,
} from "react-aria-components";
import { VisuallyHidden } from "react-aria-components/VisuallyHidden";
import { ApiError } from "../../api/client";
import { UNDO_MS, useSaveTest, useTest } from "../../api/queries";
import { cooldown } from "../../cooldown";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { notify, toasts } from "../../ui/Toasts";
import { autosave, type SaveState } from "./autosave";
import { Checks } from "./Checks";
import { QuestionEditor } from "./editors/QuestionEditor";
import {
  convertQuestion,
  fromPasted,
  insertAt,
  listed,
  newQuestion,
  tagCounts,
  withTag,
} from "./model";
import { PasteDialog } from "./PasteDialog";
import { PreviewPane } from "./PreviewPane";
import { QuestionList } from "./QuestionList";
import { SettingsDialog } from "./SettingsDialog";
import { StartDialog } from "./StartDialog";
import { TypePicker } from "./TypePicker";
import "./builder.css";
import "./topbar.css";
import "./list.css";
import "./editor.css";
import "./preview.css";
import "./editors/editors.css";
import "./dialogs.css";

const PALETTE_NAMES: Record<PaletteId, () => string> = {
  teal: m.palette_teal,
  grape: m.palette_grape,
  coral: m.palette_coral,
  lavender: m.palette_lavender,
  classic: m.palette_classic,
};

const SAVE_TEXT: Record<SaveState, () => string> = {
  saved: m.builder_saved,
  saving: m.builder_saving,
  retrying: m.builder_retrying,
  refused: m.builder_refused,
};

/**
 * Edits whose save failed as the teacher left their test, by test id, with
 * the toast that offers to go back. Opening the test again restores them.
 */
const kept = new Map<string, { test: Test; toast: string }>();

/** Where the teacher's choice to show or hide the preview is kept. */
const PREVIEW_KEY = "klats.builder.preview";

/** The preview starts open on screens 1440 px wide and up, unless the teacher chose. */
function previewOpen(): boolean {
  try {
    const chosen = localStorage.getItem(PREVIEW_KEY);
    if (chosen) return chosen === "open";
  } catch {}
  return window.innerWidth >= 1440;
}

function keepPreview(open: boolean): void {
  try {
    localStorage.setItem(PREVIEW_KEY, open ? "open" : "closed");
  } catch {}
}

/**
 * The builder at /tests/$id. It brings its own top bar. It opens at the
 * question `?q=` names, or at the first one when the test has no such question.
 */
export function BuilderPage() {
  const { id } = useParams({ from: "/tests/$id" });
  const { q } = useSearch({ from: "/tests/$id" });
  const doc = useTest(id);
  if (doc.isError) {
    const tooNew =
      doc.error instanceof ApiError && doc.error.code === "test_too_new";
    return (
      <div className="b-app">
        <header className="b-bar">
          <BackLink />
        </header>
        <LoadError
          onRetry={() => doc.refetch()}
          text={tooNew ? m.tests_file_too_new() : undefined}
        />
      </div>
    );
  }
  if (!doc.data) return null;
  return <Builder key={id} doc={doc.data} first={q} />;
}

function BackLink() {
  return (
    <Link to="/" className="b-back">
      <Icon name="back" />
      {m.nav_tests()}
    </Link>
  );
}

/**
 * The test being edited. It is read from `doc` once; from then on this
 * component holds the test, and every edit autosaves the whole of it (see
 * {@link autosave}). Leaving saves what is pending; when that save fails, the
 * edits wait in memory, with a toast «Зміни не збережено» that goes back to
 * them, until the test is opened again. Deleting a question or an
 * item of one takes effect at once, with a «Скасувати» toast for {@link UNDO_MS}
 * that puts it back where it was. While the list shows the questions of one
 * tag, every question added or pasted gets that tag. The question `first` is
 * selected at the start when the test has it.
 */
function Builder({ doc, first }: { doc: TestDoc; first?: string }) {
  const save = useSaveTest(doc.id);
  const navigate = useNavigate();
  const [seed] = useState(() => kept.get(doc.id)?.test ?? doc.test);
  const [test, setTest] = useState(seed);
  // The newest test, for edits made before React renders the last one.
  const latest = useRef(seed);
  const [problems, setProblems] = useState(doc.problems);
  const [status, setStatus] = useState<SaveState>("saved");
  const [selected, setSelected] = useState(
    (seed.questions.find((q) => q.id === first) ?? seed.questions[0])?.id ?? "",
  );
  // A question just added, whose text takes focus.
  const [fresh, setFresh] = useState("");
  const [open, setOpen] = useState(previewOpen);
  // «Показати»: null for every question, "" for those without a tag, or a tag.
  const [shown, setShown] = useState<string | null>(null);
  // The next question's trash takes the place of the deleted one's.
  const [mayDelete] = useState(() => cooldown());
  const [saver] = useState(() =>
    autosave<Test, SaveResult>({
      save: save.mutateAsync,
      onSaved: (r) => setProblems(r.problems),
      onState: setStatus,
      refused: (err) =>
        err instanceof ApiError && err.status >= 400 && err.status < 500,
    }),
  );
  const undoToasts = useRef<string[]>([]);

  useEffect(() => {
    document.body.classList.add("b-body");
    return () => document.body.classList.remove("b-body");
  }, []);

  // shortcut: closing the window within 400 ms of an edit, or while saves
  // fail, drops those edits. Save on pagehide too if teachers lose edits that way.
  useEffect(() => {
    saver.start();
    const back = kept.get(doc.id);
    if (back) {
      kept.delete(doc.id);
      toasts.close(back.toast);
      saver.change(back.test);
    }
    return () => {
      for (const key of undoToasts.current) toasts.close(key);
      saver.stop().catch(() => {
        const toast = toasts.add(
          {
            text: m.builder_not_saved(),
            action: {
              label: m.classes_back(),
              onAction: () =>
                navigate({ to: "/tests/$id", params: { id: doc.id } }),
            },
          },
          { timeout: 8000 },
        );
        kept.set(doc.id, { test: latest.current, toast });
      });
    };
  }, [saver, doc.id, navigate]);

  const update = (fn: (t: Test) => Test) => {
    const next = fn(latest.current);
    latest.current = next;
    setTest(next);
    saver.change(next);
  };

  const updateQuestion = (id: string, fn: (q: Question) => Question) =>
    update((t) => ({
      ...t,
      questions: t.questions.map((q) => (q.id === id ? fn(q) : q)),
    }));

  const select = (id: string) => {
    setSelected(id);
    setFresh("");
  };

  const known = tagCounts(test.questions);
  // A tag no question carries any more shows every question.
  const showing = shown && !known.some(([t]) => t === shown) ? null : shown;

  /**
   * Puts `qs` after the selected question, tagged with the tag the list
   * shows, and selects the first of them.
   */
  const insert = (qs: Question[]) => {
    const all = latest.current.questions;
    const at = all.findIndex((q) => q.id === selected) + 1 || all.length;
    const added = showing ? qs.map((q) => withTag(q, showing)) : qs;
    update((t) => ({
      ...t,
      questions: [
        ...t.questions.slice(0, at),
        ...added,
        ...t.questions.slice(at),
      ],
    }));
    select(qs[0].id);
  };

  const offerUndo = (text: string, restore: () => void) => {
    let done = false;
    const key = toasts.add(
      {
        text,
        action: {
          label: m.action_undo(),
          onAction: () => {
            if (done) return;
            done = true;
            toasts.close(key);
            restore();
          },
        },
      },
      { timeout: UNDO_MS },
    );
    undoToasts.current.push(key);
  };

  const removeQuestion = (id: string) => {
    const all = latest.current.questions;
    const index = all.findIndex((q) => q.id === id);
    if (index < 0) return;
    const gone = all[index];
    update((t) => ({
      ...t,
      questions: t.questions.filter((q) => q.id !== id),
    }));
    // The next row the list shows, so a filtered list keeps to its filter.
    const rows = listed(all, showing, id);
    const row = rows.findIndex((r) => r.question.id === id);
    const next = rows[row + 1] ?? rows[row - 1];
    select(next?.question.id ?? all[index + 1]?.id ?? all[index - 1]?.id ?? "");
    offerUndo(m.builder_question_deleted({ number: index + 1 }), () => {
      update((t) => ({ ...t, questions: insertAt(t.questions, index, gone) }));
      select(gone.id);
    });
  };

  /** Takes an item out of a question now and offers to put it back. */
  const removeItem = (
    questionId: string,
    text: string,
    remove: () => void,
    restore: () => void,
  ) => {
    remove();
    offerUndo(text, () => {
      restore();
      select(questionId);
    });
  };

  const toggle = (next: boolean) => {
    setOpen(next);
    keepPreview(next);
  };

  const found = test.questions.findIndex((q) => q.id === selected);
  const index = found < 0 ? 0 : found;
  const question = test.questions[index];
  const errors = new Set(
    problems.filter((p) => p.severity === "error").map((p) => p.questionId),
  );
  const palette: PaletteId =
    test.palette in PALETTES ? (test.palette as PaletteId) : "teal";

  return (
    <div className="b-app">
      <header className="b-bar">
        <BackLink />
        <div className="b-ttl">
          <TextField
            className="b-title"
            aria-label={m.builder_title_label()}
            value={test.title}
            onChange={(title) => update((t) => ({ ...t, title }))}
            onBlur={() => {
              if (!latest.current.title.trim()) {
                update((t) => ({ ...t, title: m.tests_new() }));
              }
            }}
          >
            <Input />
          </TextField>
          <span className="b-saved" data-state={status}>
            <i className="b-saved-dot" aria-hidden="true" />
            {SAVE_TEXT[status]()}
          </span>
          {/* Only the states that need the teacher are announced: "saving"
              and "saved" alternate on every pause in typing. */}
          <VisuallyHidden role="status">
            {status === "retrying" || status === "refused"
              ? SAVE_TEXT[status]()
              : ""}
          </VisuallyHidden>
        </div>
        <RadioGroup
          className="b-pal"
          orientation="horizontal"
          value={palette}
          onChange={(p) => update((t) => ({ ...t, palette: p }))}
        >
          <Label>{m.builder_palette()}</Label>
          <div className="b-sws">
            {(Object.keys(PALETTES) as PaletteId[]).map((id) => (
              <RadioField key={id} value={id}>
                <RadioButton className="b-sw">
                  <i
                    className="b-sw-half"
                    style={{ background: PALETTES[id].field }}
                  />
                  <i
                    className="b-sw-half"
                    style={{ background: PALETTES[id].accent }}
                  />
                  <span className="b-sr">{PALETTE_NAMES[id]()}</span>
                </RadioButton>
              </RadioField>
            ))}
          </div>
        </RadioGroup>
        <SettingsDialog
          settings={test.settings}
          questions={test.questions}
          onChange={(settings) => update((t) => ({ ...t, settings }))}
        />
        <StartDialog
          isDisabled={test.questions.length === 0}
          testId={doc.id}
          questions={test.questions}
          settings={test.settings}
          problems={problems}
          flush={saver.flush}
          onGoTo={select}
        />
      </header>
      <div className="b-cols" data-preview={open ? "open" : "closed"}>
        <QuestionList
          questions={test.questions}
          selected={question?.id ?? ""}
          errors={errors}
          shown={showing}
          known={known}
          onSelect={select}
          onShow={setShown}
        >
          <TypePicker
            onPick={(type) => {
              const q = newQuestion(type);
              insert([q]);
              setFresh(q.id);
            }}
          />
          <PasteDialog
            onAdd={(found) => {
              insert(fromPasted(found));
              notify(m.paste_added({ count: found.length }));
            }}
          />
          {showing && (
            <p className="b-tag-hint">{m.tags_new_hint({ tag: showing })}</p>
          )}
        </QuestionList>
        <main className="t-panel b-ed">
          {question ? (
            <QuestionEditor
              key={question.id}
              question={question}
              known={known}
              focusText={fresh === question.id ? 1 : 0}
              onChange={(fn) => updateQuestion(question.id, fn)}
              onDelete={() => mayDelete() && removeQuestion(question.id)}
              onRemoveItem={(text, remove, restore) =>
                removeItem(question.id, text, remove, restore)
              }
            />
          ) : (
            <div className="b-ed-empty">
              <span className="t-mark t-mark-big" aria-hidden="true">
                <Icon name="plus" />
              </span>
              <h2>{m.builder_empty_title()}</h2>
              <p>{m.builder_empty_text()}</p>
            </div>
          )}
        </main>
        <PreviewPane
          test={test}
          palette={palette}
          index={index}
          open={open}
          onToggle={toggle}
        >
          <Checks
            problems={problems}
            questions={test.questions}
            onSelect={select}
            onMakeMulti={(id) => {
              updateQuestion(id, (q) => convertQuestion(q, "multi"));
              select(id);
            }}
          />
        </PreviewPane>
      </div>
    </div>
  );
}
