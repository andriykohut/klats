import type {
  Problem,
  Question,
  Settings,
} from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  FieldError,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  RadioButton,
  RadioField,
  RadioGroup,
  TextField,
} from "react-aria-components";
import { ApiError, startSitting } from "../../api/client";
import { busy, useClasses, useLive } from "../../api/queries";
import { notify } from "../../ui/Toasts";
import { problemText } from "./Checks";

/** The value of «Без списку»; class ids are never empty. */
const NO_LIST = "";

const FIVE_MINUTES = 5 * 60_000;

/** The proposed end of a test of `minutes` started now: the next 5 minutes or later, as "HH:MM". */
function proposedEnd(minutes: number): string {
  const at = new Date(
    Math.ceil((Date.now() + minutes * 60_000) / FIVE_MINUTES) * FIVE_MINUTES,
  );
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The moment "HH:MM" next comes up today, in unix ms, or null for an unfinished field. */
function endAt(time: string): number | null {
  const [h, min] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return new Date().setHours(h, min, 0, 0);
}

/** A save that failed before the sitting could start. */
class SaveFailed extends Error {}

interface StartProps {
  testId: string;
  questions: Question[];
  /** The test's settings; a common end time is asked for at the start. */
  settings: Settings;
  /** The problems of the last save; those of severity "error" block a start. */
  problems: Problem[];
  /** Saves pending edits; it rejects when the save fails. */
  flush: () => Promise<void>;
  /** Selects a question, from a link in the problem list. */
  onGoTo: (questionId: string) => void;
}

/**
 * «Почати тест»: a dialog to pick the class (or «Без списку», where students
 * type their names) and start a sitting, which then opens the live view. A
 * test with a common end time also asks «Закінчити о», prefilled with the
 * test's minutes from now and refused once that time has passed. Problems that block the start, known from the last save or returned by the
 * server, are listed with links to their questions; a sitting already
 * running is named, with a link to it.
 */
export function StartDialog(props: StartProps & { isDisabled: boolean }) {
  return (
    <DialogTrigger>
      <Button
        className="t-btn b-go"
        data-variant="primary"
        isDisabled={props.isDisabled}
      >
        {m.builder_start()}
      </Button>
      <ModalOverlay isDismissable className="t-scrim">
        <Modal className="t-modal">
          <Dialog className="t-dialog b-start">
            {({ close }) => <StartForm {...props} close={close} />}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function StartForm(props: StartProps & { close: () => void }) {
  const classes = useClasses();
  const live = useLive();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<string | null>(null);
  const [refused, setRefused] = useState<Problem[] | null>(null);
  const [taken, setTaken] = useState(false);
  const common = props.settings.timeLimit.mode === "common";
  const [end, setEnd] = useState(() =>
    proposedEnd(props.settings.timeLimit.minutes),
  );
  const endsAt = common ? endAt(end) : null;
  const past = endsAt !== null && endsAt <= Date.now();
  const start = useMutation({
    mutationKey: ["startSitting"],
    mutationFn: async (classId: string) => {
      await props.flush().catch(() => {
        throw new SaveFailed();
      });
      return startSitting({
        testId: props.testId,
        classId: classId === NO_LIST ? undefined : classId,
        endsAt: common ? (endsAt ?? undefined) : undefined,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["live"] });
      props.close();
      navigate({ to: "/live" });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "has_problems") {
        setRefused(err.problems ?? []);
      } else if (err instanceof ApiError && err.code === "sitting_active") {
        setTaken(true);
      } else {
        notify(
          err instanceof SaveFailed ? m.start_save_failed() : m.error_server(),
          true,
        );
      }
    },
  });

  const number = new Map(props.questions.map((q, i) => [q.id, i + 1]));
  const type = new Map(props.questions.map((q) => [q.id, q.type]));
  const blocking = (refused ?? props.problems).filter(
    (p) => p.severity === "error" && number.has(p.questionId),
  );
  const running = taken || (live.data != null && !live.data.sitting.ended);
  const collator = new Intl.Collator("uk", { numeric: true });
  const sorted = [...(classes.data ?? [])].sort((a, b) =>
    collator.compare(a.name, b.name),
  );

  return (
    <>
      <Heading slot="title">{m.builder_start()}</Heading>
      <p>{m.start_text()}</p>
      <RadioGroup
        className="b-classes"
        aria-label={m.start_text()}
        value={choice}
        onChange={setChoice}
      >
        {sorted.map((c) => (
          <RadioField key={c.id} value={c.id} className="b-class-field">
            <RadioButton className="b-class">
              <b>{c.name}</b>
              <span className="b-class-meta">
                {m.classes_students({ count: c.studentCount })}
              </span>
            </RadioButton>
          </RadioField>
        ))}
        <RadioField value={NO_LIST} className="b-class-field">
          <RadioButton className="b-class">
            <b>{m.start_no_list()}</b>
            <span className="b-class-meta">{m.start_no_list_desc()}</span>
          </RadioButton>
        </RadioField>
      </RadioGroup>
      {common && (
        <TextField
          className="t-field b-end"
          value={end}
          onChange={setEnd}
          isInvalid={past}
        >
          <Label>{m.start_end_at()}</Label>
          <Input type="time" />
          <FieldError>{m.start_end_past()}</FieldError>
        </TextField>
      )}
      {blocking.length > 0 && (
        <div className="t-notice b-start-problems" data-tone="error">
          <div>
            <p>{m.start_problems()}</p>
            <ul>
              {blocking.map((p) => (
                <li key={`${p.questionId} ${p.code} ${p.count ?? 0}`}>
                  <Button
                    className="b-tip-link"
                    onPress={() => {
                      props.close();
                      props.onGoTo(p.questionId);
                    }}
                  >
                    {problemText(
                      p,
                      number.get(p.questionId) ?? 0,
                      type.get(p.questionId) ?? "",
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {running && (
        <div className="t-notice b-start-running">
          <div>
            <p>{m.start_active()}</p>
            <Link to="/live" className="b-link">
              {m.start_open_live()}
            </Link>
          </div>
        </div>
      )}
      <div className="t-dialog-actions">
        <Button slot="close" className="t-btn" data-variant="quiet">
          {m.action_cancel()}
        </Button>
        <Button
          className="t-btn"
          data-variant="primary"
          isDisabled={
            choice === null ||
            blocking.length > 0 ||
            running ||
            (common && (endsAt === null || past))
          }
          isPending={start.isPending}
          onPress={() => {
            if (choice === null || busy("startSitting")) return;
            start.mutate(choice);
          }}
        >
          {m.start_go()}
        </Button>
      </div>
    </>
  );
}
