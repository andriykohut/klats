import { isAnswered } from "@klats/shared/answers.ts";
import type {
  AssignmentResults,
  ResultQuestion,
  ResultRow,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { type RichDoc, RichView } from "@klats/shared/rich/RichView.tsx";
import { useState } from "react";
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
import { band, formatDate, formatPoints } from "../live/journal";

/**
 * One student's answers, in a panel over the right of the results: each
 * question as the sitting's test had it, the options the student chose and
 * the correct ones, and the points, which the teacher can set from 0 to the
 * question's points or reset to the automatic score. The grade follows at
 * once. It renders nothing once the participant is no longer in the results.
 */
export function StudentDetail(props: {
  results: AssignmentResults;
  participantId: string;
  onClose: () => void;
}) {
  const row = props.results.rows.find(
    (r) => r.participantId === props.participantId,
  );
  if (!row) return null;
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
              <span className="j-gr r-detail-grade" data-band={band(row.grade)}>
                {row.grade}
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
  assignmentId: string;
}) {
  const { row } = props;
  const q = props.question.question;
  const override = useSetOverride(props.assignmentId);
  const picked = row.answers[q.id]?.items ?? [];
  const overridden = row.overridden.includes(q.id);
  const late = row.late.includes(q.id);
  // The field shows what was typed until the server's points change.
  const [value, setValue] = useState(props.points);
  const [server, setServer] = useState(props.points);
  if (server !== props.points) {
    setServer(props.points);
    setValue(props.points);
  }
  const set = (points: number | undefined) =>
    override.mutate(
      { participantId: row.participantId, questionId: q.id, points },
      { onError: () => setValue(props.points) },
    );

  return (
    <li className="r-q">
      <div className="r-q-head">
        <b>{m.detail_question({ number: props.number })}</b>
        <span>{m.builder_count_points({ count: q.points })}</span>
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
      <ul className="r-opts">
        {q.options.map((o) => {
          const chosen = picked.includes(o.id);
          return (
            <li
              key={o.id}
              className="r-opt"
              data-chosen={chosen || undefined}
              data-correct={o.correct || undefined}
            >
              <span className="r-mark" data-type={q.type} aria-hidden="true">
                {chosen && <Icon name="check" />}
              </span>
              <span className="r-opt-text">
                <RichView doc={o.content as RichDoc} />
              </span>
              {chosen && <small className="r-tag">{m.detail_picked()}</small>}
              {o.correct && (
                <small className="r-tag" data-tone="ok">
                  {m.detail_correct()}
                </small>
              )}
            </li>
          );
        })}
      </ul>
      {!isAnswered(row.answers[q.id]) && (
        <p className="r-none">{m.detail_no_answer()}</p>
      )}
      <div className="r-points">
        <NumberField
          className="r-points-field"
          value={value}
          minValue={0}
          maxValue={q.points}
          formatOptions={{ maximumFractionDigits: 2 }}
          onChange={(v) => {
            if (Number.isNaN(v) || v === props.points) return;
            setValue(v);
            set(v);
          }}
        >
          <Label>{m.col_points()}</Label>
          <Input aria-describedby={`r-of-${q.id}`} />
        </NumberField>
        <span id={`r-of-${q.id}`}>{m.of_total({ total: q.points })}</span>
        {overridden && (
          <Button
            className="t-btn r-reset"
            data-variant="quiet"
            onPress={() => !busy("override") && set(undefined)}
          >
            {m.detail_clear()}
          </Button>
        )}
      </div>
    </li>
  );
}
