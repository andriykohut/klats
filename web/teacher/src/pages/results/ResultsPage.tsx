import type {
  AssignmentResults,
  ResultRow,
} from "@klats/shared/generated/wire.ts";
import { gradeBand, gradeText } from "@klats/shared/grades.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "react-aria-components";
import { busy, useExport, useResults } from "../../api/queries";
import { finishExport } from "../../ui/finishExport";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { plainText } from "../builder/model";
import {
  type CellState,
  type JournalCell,
  type JournalColumn,
  JournalTable,
  PendingGrade,
} from "../live/JournalTable";
import {
  formatDate,
  formatPoints,
  gradeWidth,
  padCells,
} from "../live/journal";
import { StudentDetail } from "./StudentDetail";
import { TagScores } from "./TagScores";
import "./results.css";

const RESULTS_LEGEND = () =>
  [
    { swatch: { state: "full" }, label: m.legend_full() },
    { swatch: { state: "partial" }, label: m.legend_partial() },
    { swatch: { state: "zero" }, label: m.legend_zero() },
    { swatch: { state: "pending" }, label: m.legend_pending() },
    {
      swatch: { state: "empty", overridden: true },
      label: m.legend_overridden(),
    },
    { swatch: { state: "empty", late: true }, label: m.legend_late() },
  ] as const;

/** Formats seconds as m:ss, or «—» for a participant who has not finished. */
const duration = (sec: number) =>
  sec > 0
    ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
    : "—";

/**
 * The results of one assignment at /assignments/$id: the scores per tag when
 * the test has tags, the journal with the points per question, each row
 * opening the student's answers, and the Excel export.
 */
export function ResultsPage() {
  const { id } = useParams({ from: "/shell/assignments/$id" });
  const results = useResults(id);
  // The student whose answers are open, and the question whose points field
  // takes focus there.
  const [open, setOpen] = useState<{ id: string; focus?: string } | null>(null);
  if (results.isError) return <LoadError onRetry={() => results.refetch()} />;
  const res = results.data;
  if (!res) return null;
  const locale = getLocale();
  const first = Math.min(...res.rows.map((r) => r.sittingDate));
  const about = [
    res.className || m.results_no_class(),
    res.rows.length > 0 &&
      formatDate(first, locale, { day: "numeric", month: "long" }),
    m.classes_students({ count: res.rows.length }),
  ]
    .filter(Boolean)
    .join(" · ");
  const typed = res.className === "";
  const pts = (n: number) => formatPoints(n, locale);
  const waiting = res.rows.filter((r) => r.pendingIds.length > 0);
  const toReview = waiting.reduce((n, r) => n + r.pendingIds.length, 0);

  // A drawn test's rows may differ in length: the columns reach the longest.
  const questions = res.drawn
    ? Math.max(0, ...res.rows.map((r) => r.order.length))
    : res.questions.length;

  const after: JournalColumn[] = [
    { head: m.col_points(), width: 82, className: "r-col-num" },
    {
      head: m.col_grade(),
      width: waiting.length > 0 ? 190 : gradeWidth(res.scale),
      className: "j-grade",
    },
    { head: m.col_time(), width: 64, className: "r-col-num" },
    { head: m.col_date(), width: 110 },
  ];

  return (
    <div className="t-page t-page-fill r-page">
      <header className="t-page-head">
        <div className="r-head">
          <Link to="/assignments" className="r-back">
            <Icon name="back" />
            {m.nav_results()}
          </Link>
          <h1>{res.testTitle}</h1>
          <p>{about}</p>
        </div>
        <div className="r-export">
          {toReview > 0 && (
            <Button
              className="t-btn"
              onPress={() =>
                setOpen({
                  id: waiting[0].participantId,
                  focus: waiting[0].pendingIds[0],
                })
              }
            >
              {m.results_review({ count: toReview })}
            </Button>
          )}
          {res.exported && res.exportStale && (
            <span className="j-chip r-stale" data-tone="tang">
              {m.results_stale()}
            </span>
          )}
          <ExportButton id={id} />
        </div>
      </header>
      {res.tags.length > 0 && <TagScores tags={res.tags} />}
      <JournalTable
        variant="results"
        questions={questions}
        before={
          typed
            ? [{ head: m.typed_class(), width: 70, className: "j-device" }]
            : []
        }
        after={after}
        pct={
          res.drawn ? undefined : res.questions.map((q) => q.correctPct ?? null)
        }
        footLabel={res.drawn ? undefined : m.live_class_correct()}
        barLabel={(t) =>
          m.live_bar({ correct: t.good, wrong: t.bad, left: t.left })
        }
        legend={RESULTS_LEGEND()}
        rows={res.rows.map((r) => ({
          key: r.participantId,
          name: (
            <Button
              className="r-open"
              onPress={() => setOpen({ id: r.participantId })}
            >
              {r.name}
            </Button>
          ),
          cells: padCells(
            cellsOf(res, r, pts, (focus) =>
              setOpen({ id: r.participantId, focus }),
            ),
            questions,
          ),
          before: typed
            ? [
                <td key="class" className="j-device">
                  {r.className}
                </td>,
              ]
            : [],
          after: [
            <td key="pts" className="r-col-num">
              {pts(r.earned)} / {pts(r.max)}
            </td>,
            <td key="grade" className="j-grade">
              {r.pendingIds.length > 0 ? (
                <PendingGrade />
              ) : (
                <span
                  className="j-gr"
                  data-band={gradeBand(res.scale, r.grade)}
                >
                  {gradeText(res.scale, r.grade)}
                </span>
              )}
            </td>,
            <td key="time" className="r-col-num">
              {duration(r.durationSec)}
            </td>,
            <td key="date" className="j-device">
              {formatDate(r.sittingDate, locale, {
                day: "numeric",
                month: "short",
              })}
            </td>,
          ],
        }))}
      />
      {open && (
        <StudentDetail
          results={res}
          participantId={open.id}
          focus={open.focus}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/**
 * The cells of a row: full, partial or zero points for an answered or
 * overridden question, empty for an unanswered one, with the points inside,
 * and the marks of an override and of a late answer. A written answer waiting
 * for the teacher is a "pending" cell that is a button, which calls `review`
 * with the question's id. A question the student did not get is "absent".
 * In a drawn test the cells follow the student's own order, numbered as on
 * their sheet, each with a tooltip naming its question in the test.
 */
function cellsOf(
  res: AssignmentResults,
  r: ResultRow,
  pts: (n: number) => string,
  review: (questionId: string) => void,
): JournalCell[] {
  // `i` is the question's place in the test, `own` its place on the sheet.
  const cell = (i: number, own: number): JournalCell => {
    const q = res.questions[i].question;
    if (r.notAsked.includes(q.id)) return { state: "absent" };
    if (r.pendingIds.includes(q.id)) {
      return {
        state: "pending",
        late: r.late.includes(q.id),
        onPress: () => review(q.id),
        label: `${own + 1}: ${m.status_pending()}`,
      };
    }
    const got = r.points[i];
    const overridden = r.overridden.includes(q.id);
    const answered = q.id in r.answers || overridden;
    let state: CellState = "empty";
    if (Math.abs(got - q.points) < 1e-9) state = "full";
    else if (got > 0) state = "partial";
    else if (answered) state = "zero";
    return {
      state,
      text: answered ? pts(got) : "",
      overridden,
      late: r.late.includes(q.id),
    };
  };
  if (!res.drawn) return res.questions.map((_, i) => cell(i, i));
  return r.order.map((id, own) => {
    const i = res.questions.findIndex((q) => q.question.id === id);
    const text = [...plainText(res.questions[i].question.text)];
    return {
      ...cell(i, own),
      title: m.journal_cell_question({
        number: i + 1,
        // Cut as the live view's texts are.
        text:
          text.length > 120 ? `${text.slice(0, 120).join("")}…` : text.join(""),
      }),
    };
  });
}

/**
 * «Експорт в Excel». In the desktop app a save dialog picks the file and a
 * toast names where it went; a cancelled dialog shows nothing. Without the
 * desktop window (`klats -dev`) the workbook downloads through the browser.
 */
function ExportButton({ id }: { id: string }) {
  const exp = useExport(id);
  return (
    <Button
      className="t-btn"
      data-variant="teal"
      isPending={exp.isPending}
      onPress={() => {
        if (busy("export")) return;
        exp.mutate(undefined, { onSuccess: finishExport });
      }}
    >
      <Icon name="download" />
      {m.results_export()}
    </Button>
  );
}
