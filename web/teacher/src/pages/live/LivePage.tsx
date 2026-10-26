import type { LiveRow, LiveSnapshot } from "@klats/shared/generated/wire.ts";
import { gradeBand, gradeText } from "@klats/shared/grades.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SwitchButton, SwitchField } from "react-aria-components";
import { useLive } from "../../api/queries";
import { Banners } from "../../ui/Banners";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { TopBar } from "../../ui/TopBar";
import { BoardView } from "./BoardView";
import { EventsPanel } from "./EventsPanel";
import {
  type CellState,
  type JournalColumn,
  type JournalRow,
  JournalTable,
  PendingGrade,
} from "./JournalTable";
import { gradeWidth, initials } from "./journal";
import { LiveTopBar } from "./LiveTopBar";
import { RowActions } from "./RowActions";
import { Summary } from "./Summary";
import "./live.css";

/** Where the «Приховати імена» choice is kept between lessons. */
const HIDDEN_KEY = "klats.live.hidden";

function hiddenAtStart(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function keepHidden(on: boolean): void {
  try {
    localStorage.setItem(HIDDEN_KEY, on ? "1" : "0");
  } catch {}
}

/**
 * The live view at /live: the running sitting, or the last ended one until
 * the next starts. It brings its own bar. With no sitting since launch it is
 * a calm page with the app's bar that leads to «Мої тести».
 */
export function LivePage() {
  const live = useLive();
  if (live.data === undefined && !live.isError) return null;
  if (!live.data) {
    return (
      <div className="t-app">
        <TopBar />
        <Banners />
        <main className="t-main">
          {live.isError ? (
            <LoadError onRetry={() => live.refetch()} />
          ) : (
            <div className="t-page">
              <div className="t-empty">
                <span className="t-mark t-mark-big" aria-hidden="true">
                  <Icon name="check" />
                </span>
                <h1>{m.live_none_title()}</h1>
                <p>{m.live_none_text()}</p>
                <Link to="/" className="t-btn" data-variant="primary">
                  {m.nav_tests()}
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }
  return <Live snap={live.data} />;
}

const LIVE_LEGEND = () =>
  [
    { swatch: { state: "correct" }, label: m.live_legend_correct() },
    { swatch: { state: "wrong" }, label: m.live_legend_wrong() },
    { swatch: { state: "pending" }, label: m.legend_pending() },
    { swatch: { state: "current" }, label: m.live_legend_current() },
  ] as const;

const HIDDEN_LEGEND = () =>
  [
    { swatch: { state: "answered" }, label: m.live_legend_answered() },
    { swatch: { state: "pending" }, label: m.legend_pending() },
    { swatch: { state: "current" }, label: m.live_legend_current() },
  ] as const;

/**
 * A live cell as the journal draws it: correct and wrong become "answered"
 * while names are hidden, a written answer waiting for the teacher
 * ("pending") and a question the student did not get ("absent") show as such
 * either way since they say nothing about being right, and a value this
 * version does not know is empty.
 */
function liveCell(state: string, hidden: boolean): CellState {
  if (state === "correct" || state === "wrong") {
    return hidden ? "answered" : state;
  }
  if (state === "pending" || state === "absent") return state;
  return state === "current" ? "current" : "empty";
}

function Live({ snap }: { snap: LiveSnapshot }) {
  const [hidden, setHidden] = useState(hiddenAtStart);
  const [board, setBoard] = useState(false);
  const ended = snap.sitting.ended;
  const who = hidden ? initials : (name: string) => name;
  // Rows in a pending name clash: the participant holding the name.
  const clashed = new Set(
    snap.events
      .filter((e) => e.pinned && e.kind === "name_clash")
      .map((e) => e.params.participantId),
  );
  const writing = snap.rows.filter((r) => r.status !== "finished").length;

  const after: JournalColumn[] = [
    { head: m.col_status(), width: 210 },
    {
      head: m.col_grade(),
      // Wide only while a pending grade is drawn: a finished row's, with names shown.
      width:
        !hidden && snap.rows.some((r) => r.grade != null && r.pending > 0)
          ? 190
          : gradeWidth(snap.sitting.scale),
      className: "j-grade",
    },
  ];
  // The server refuses kicks and renames once the sitting has ended.
  if (!ended) after.push({ head: "", width: 44 });

  const rows: JournalRow[] = snap.rows.map((r) => {
    const clash = clashed.has(r.participantId);
    return {
      key: r.participantId,
      name: who(r.name),
      tone: clash ? "clash" : r.status === "offline" ? "offline" : undefined,
      cells: r.cells.map((state) => ({ state: liveCell(state, hidden) })),
      before: [
        <td key="pc" className="j-device" title={r.deviceLabel}>
          {r.deviceLabel}
        </td>,
      ],
      after: [
        <td key="status">
          <span className="j-chips">
            <StatusChip row={r} clash={clash} />
            {r.windowSwitches > 0 && (
              <span className="j-chip" data-tone="tang">
                {m.status_switches({ count: r.windowSwitches })}
              </span>
            )}
          </span>
        </td>,
        <td key="grade" className="j-grade">
          {r.grade != null &&
            !hidden &&
            (r.pending > 0 ? (
              <PendingGrade />
            ) : (
              <span
                className="j-gr"
                data-band={gradeBand(snap.sitting.scale, r.grade)}
              >
                {gradeText(snap.sitting.scale, r.grade)}
              </span>
            ))}
        </td>,
        ...(ended
          ? []
          : [
              <td key="menu" className="j-act">
                <RowActions row={r} name={who(r.name)} />
              </td>,
            ]),
      ],
    };
  });

  return (
    <div className="l-app">
      <LiveTopBar
        sitting={snap.sitting}
        writing={writing}
        onBoard={() => setBoard(true)}
      />
      <Banners />
      <Summary counts={snap.counts} hidden={hidden} />
      <div className="l-main">
        <JournalTable
          questions={snap.sitting.questionCount}
          before={[{ head: m.col_device(), width: 100, className: "j-device" }]}
          after={after}
          rows={rows}
          pct={snap.questionPct.map((p) => p ?? null)}
          footLabel={m.live_class_correct()}
          barLabel={(t) =>
            hidden
              ? m.live_bar_hidden({ answered: t.answered, left: t.left })
              : m.live_bar({ correct: t.good, wrong: t.bad, left: t.left })
          }
          legend={hidden ? HIDDEN_LEGEND() : LIVE_LEGEND()}
          tools={
            <SwitchField
              className="j-switch"
              isSelected={hidden}
              onChange={(on) => {
                setHidden(on);
                keepHidden(on);
              }}
            >
              <SwitchButton className="j-switch-btn">
                <i className="j-switch-track" aria-hidden="true" />
                {m.live_hide_names()}
              </SwitchButton>
            </SwitchField>
          }
        />
        <EventsPanel
          events={snap.events}
          rows={snap.rows}
          who={who}
          hidden={hidden}
          scale={snap.sitting.scale}
        />
      </div>
      <BoardView
        isOpen={board && !ended}
        onClose={() => setBoard(false)}
        code={snap.sitting.code}
        finished={snap.counts.finished}
        total={snap.counts.inTest}
      />
    </div>
  );
}

/**
 * The row's state. A clash shows «Без зв’язку» beside it while the holder is
 * offline, the case in which the events panel offers to move the name.
 */
function StatusChip({ row, clash }: { row: LiveRow; clash: boolean }) {
  if (clash) {
    return (
      <>
        <span className="j-chip" data-tone="red">
          {m.status_clash()}
        </span>
        {row.status === "offline" && (
          <span className="j-chip" data-tone="tang">
            {m.status_offline()}
          </span>
        )}
      </>
    );
  }
  if (row.status === "offline") {
    return (
      <span className="j-chip" data-tone="tang">
        {m.status_offline()}
      </span>
    );
  }
  if (row.status === "finished") {
    return (
      <span className="j-chip" data-tone="mint">
        {m.status_finished()}
      </span>
    );
  }
  return <span className="j-chip">{m.status_writing()}</span>;
}
