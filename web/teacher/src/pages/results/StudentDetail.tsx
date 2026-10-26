import { hasAnswer } from "@klats/shared/answers.ts";
import type {
  AssignmentResults,
  ResultQuestion,
  ResultRow,
} from "@klats/shared/generated/wire.ts";
import { gradeBand, gradeText } from "@klats/shared/grades.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { type RichDoc, RichView } from "@klats/shared/rich/RichView.tsx";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  I18nProvider,
  Input,
  Label,
  Modal,
  ModalOverlay,
  NumberField,
} from "react-aria-components";
import { busy, useSetOverride } from "../../api/queries";
import { Icon } from "../../ui/icons";
import { formatDate, formatPoints } from "../live/journal";
import { AnswerReview } from "./AnswerReview";

/**
 * One student's answers, in a panel over the right of the results: each
 * question as the sitting's test had it, the answer reviewed by its type (see
 * {@link AnswerReview}), and the points, which the teacher can set from 0 to
 * the question's points or reset to the automatic score. The grade follows at
 * once. `focus` is a question whose points field takes focus as the panel
 * opens. It renders nothing once the participant is no longer in the results.
 */
export function StudentDetail(props: {
  results: AssignmentResults;
  participantId: string;
  focus?: string;
  onClose: () => void;
}) {
  const row = props.results.rows.find(
    (r) => r.participantId === props.participantId,
  );
  if (!row) return null;
  const pending = row.pendingIds.length > 0;
  const locale = getLocale();
  const pts = (n: number) => formatPoints(n, locale);
  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => !open && props.onClose()}
      isDismissable
      className="t-scrim r-scrim"
    >
      <Modal className="r-drawer">
        <Dialog className="r-detail">
          <I18nProvider locale={locale}>
            <header className="r-detail-head">
              <span
                className="j-gr r-detail-grade"
                data-scale={props.results.scale}
                data-band={
                  pending
                    ? undefined
                    : gradeBand(props.results.scale, row.grade)
                }
              >
                {pending ? "—" : gradeText(props.results.scale, row.grade)}
              </span>
              <div>
                <Heading slot="title">{row.name}</Heading>
                <p>
                  {[
                    row.className,
                    formatDate(row.sittingDate, locale, {
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                    m.detail_score({
                      earned: pts(row.earned),
                      max: pts(row.max),
                    }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                slot="close"
                className="t-icon-btn"
                aria-label={m.action_close()}
              >
                <Icon name="close" />
              </Button>
            </header>
            <ol className="r-qs">
              {props.results.questions.map((q, i) => (
                <QuestionResult
                  key={q.question.id}
                  number={i + 1}
                  question={q}
                  row={row}
                  points={row.points[i]}
                  autoFocus={props.focus === q.question.id}
                  assignmentId={props.results.assignmentId}
                />
              ))}
            </ol>
          </I18nProvider>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function QuestionResult(props: {
  number: number;
  question: ResultQuestion;
  row: ResultRow;
  points: number;
  autoFocus: boolean;
  assignmentId: string;
}) {
  const { row } = props;
  const q = props.question.question;
  const override = useSetOverride(props.assignmentId);
  const field = useRef<HTMLInputElement>(null);
  const item = useRef<HTMLLIElement>(null);
  // Focus alone leaves the question below the fold of the panel's list.
  useEffect(() => {
    if (props.autoFocus) item.current?.scrollIntoView({ block: "center" });
  }, [props.autoFocus]);
  const overridden = row.overridden.includes(q.id);
  const pending = row.pendingIds.includes(q.id);
  const late = row.late.includes(q.id);
  // The field shows what was typed until the server's points change. A
  // pending answer starts blank, so that a 0 typed over its automatic 0 is a
  // change and grades the answer.
  const shown = pending ? Number.NaN : props.points;
  const [value, setValue] = useState(shown);
  const [server, setServer] = useState({ points: props.points, pending });
  if (server.points !== props.points || server.pending !== pending) {
    setServer({ points: props.points, pending });
    setValue(shown);
  }
  const set = (points: number | undefined) =>
    override.mutate(
      { participantId: row.participantId, questionId: q.id, points },
      { onError: () => setValue(shown) },
    );

  return (
    <li ref={item} className="r-q">
      <div className="r-q-head">
        <b>{m.detail_question({ number: props.number })}</b>
        <span>{m.builder_count_points({ count: q.points })}</span>
        {pending && (
          <span className="j-chip" data-tone="tang">
            {m.status_pending()}
          </span>
        )}
        {late && (
          <span className="j-chip" data-tone="tang">
            {m.legend_late()}
          </span>
        )}
        {overridden && <span className="j-chip">{m.legend_overridden()}</span>}
      </div>
      <div className="r-q-text">
        <RichView doc={q.text as RichDoc} />
      </div>
      <AnswerReview result={props.question} row={row} />
      {!hasAnswer(row.answers[q.id]) && (
        <p className="r-none">{m.detail_no_answer()}</p>
      )}
      <div className="r-points">
        <NumberField
          className="r-points-field"
          value={value}
          minValue={0}
          maxValue={q.points}
          autoFocus={props.autoFocus}
          formatOptions={{ maximumFractionDigits: 2 }}
          onChange={(v) => {
            if (Number.isNaN(v) || (v === props.points && !pending)) return;
            setValue(v);
            set(v);
          }}
        >
          <Label>{m.col_points()}</Label>
          <Input ref={field} aria-describedby={`r-of-${q.id}`} />
        </NumberField>
        <span id={`r-of-${q.id}`}>{m.of_total({ total: q.points })}</span>
        {overridden && (
          <Button
            className="t-btn r-reset"
            data-variant="quiet"
            onPress={() => {
              if (busy("override")) return;
              set(undefined);
              // The button is gone once the override is cleared.
              field.current?.focus();
            }}
          >
            {m.detail_clear()}
          </Button>
        )}
      </div>
    </li>
  );
}
