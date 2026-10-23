import type {
  AssignmentResults,
  ResultRow,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "react-aria-components";
import { busy, useExport, useResults } from "../../api/queries";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { notify } from "../../ui/Toasts";
import {
  type CellState,
  type JournalCell,
  type JournalColumn,
  JournalTable,
} from "../live/JournalTable";
import { band, formatDate, formatPoints } from "../live/journal";
import { StudentDetail } from "./StudentDetail";
import "./results.css";

const RESULTS_LEGEND = () =>
  [
    { swatch: { state: "full" }, label: m.legend_full() },
    { swatch: { state: "partial" }, label: m.legend_partial() },
    { swatch: { state: "zero" }, label: m.legend_zero() },
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
 * The results of one assignment at /assignments/$id: the journal with the
 * points per question, each row opening the student's answers, and the
 * Excel export.
 */
export function ResultsPage() {
  const { id } = useParams({ from: "/shell/assignments/$id" });
  const results = useResults(id);
  const [open, setOpen] = useState<string | null>(null);
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

  const after: JournalColumn[] = [
    { head: m.col_points(), width: 82, className: "r-col-num" },
    { head: m.col_grade(), width: 64, className: "j-grade" },
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
          {res.exported && res.exportStale && (
            <span className="j-chip r-stale" data-tone="tang">
              {m.results_stale()}
            </span>
          )}
          <ExportButton id={id} />
        </div>
      </header>
      <JournalTable
        variant="results"
        questions={res.questions.length}
        before={
          typed
            ? [{ head: m.typed_class(), width: 70, className: "j-device" }]
            : []
        }
        after={after}
        pct={res.questions.map((q) =>
          res.rows.length > 0 ? q.correctPct : null,
        )}
        footLabel={m.live_class_correct()}
        barLabel={(t) =>
          m.live_bar({ correct: t.good, wrong: t.bad, left: t.left })
        }
        legend={RESULTS_LEGEND()}
        rows={res.rows.map((r) => ({
          key: r.participantId,
          name: (
            <Button className="r-open" onPress={() => setOpen(r.participantId)}>
              {r.name}
            </Button>
          ),
          cells: cellsOf(res, r, pts),
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
              <span className="j-gr" data-band={band(r.grade)}>
                {r.grade}
              </span>
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
          participantId={open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/**
 * The cells of a row: full, partial or zero points for an answered or
 * overridden question, empty for an unanswered one, with the points inside,
 * and the marks of an override and of a late answer.
 */
function cellsOf(
  res: AssignmentResults,
  r: ResultRow,
  pts: (n: number) => string,
): JournalCell[] {
  return res.questions.map((q, i) => {
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
        exp.mutate(undefined, {
          onSuccess: (out) => {
            if (out instanceof File) {
              const href = URL.createObjectURL(out);
              const a = document.createElement("a");
              a.href = href;
              a.download = out.name;
              a.click();
              // WebKit reads the URL after click() returns.
              setTimeout(() => URL.revokeObjectURL(href), 1000);
              notify(m.results_downloaded({ name: out.name }));
            } else if (out) {
              notify(m.results_saved({ path: out.path }));
            }
          },
        });
      }}
    >
      <Icon name="download" />
      {m.results_export()}
    </Button>
  );
}
