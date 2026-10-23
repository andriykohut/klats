import { m } from "@klats/shared/paraglide/messages.js";
import type { CSSProperties, ReactNode } from "react";
import { COMPACT_AFTER, tally } from "./journal";
import "./journal.css";

/** A column beside the question cells, `width` px wide. */
export interface JournalColumn {
  head: ReactNode;
  width: number;
  className?: string;
}

/**
 * What a question cell shows: "correct", "wrong", "current", "empty" and
 * "answered" (live, the last while names are hidden), or "full", "partial",
 * "zero" and "empty" (results).
 */
export type CellState =
  | "correct"
  | "wrong"
  | "current"
  | "empty"
  | "answered"
  | "full"
  | "partial"
  | "zero";

/**
 * One question cell: `state` picks its colour and `text` is drawn inside. An
 * override puts a dot on its corner and a late answer outlines it.
 */
export interface JournalCell {
  state: CellState;
  text?: string;
  overridden?: boolean;
  late?: boolean;
}

/** A student's row: the name cell, the cells, and the columns around them. */
export interface JournalRow {
  key: string;
  name: ReactNode;
  tone?: "offline" | "clash";
  cells: JournalCell[];
  before: ReactNode[];
  after: ReactNode[];
}

const NUMBER_WIDTH = 34;
const NAME_WIDTH = 220;

/** Compact bars draw no current cell and no marks, so their legend leaves them out. */
const shown = (compact: boolean) => (l: { swatch: JournalCell }) =>
  !compact ||
  (l.swatch.state !== "current" && !l.swatch.overridden && !l.swatch.late);

const low = (p: number | null) => (p !== null && p < 60) || undefined;

/** Above this many questions the head numbers only every fifth question. */
const NUMBERED_EVERY = 20;
/** Up to this many questions the footer shows each percent as text. */
const PCT_AS_TEXT = 16;
/** The least share of a question cell, so long tests keep their cells. */
const MIN_CELL = 8;

/**
 * The class journal: one row per student in the order given, one cell per
 * question, and a footer with the percent of full-point answers per question
 * (`pct`, null while nobody answered), those under 60% highlighted. Above
 * {@link COMPACT_AFTER} questions each row's cells become one bar split into
 * full, fewer and no points, labelled by `barLabel`. `tools` and `legend`
 * (a sample cell beside each label) fill the strip above the head. Space
 * left over goes to an empty last column, so every column stays near the
 * name. The "results" variant draws taller cells with the points inside.
 */
export function JournalTable(props: {
  variant?: "results";
  questions: number;
  before: JournalColumn[];
  after: JournalColumn[];
  rows: JournalRow[];
  pct: (number | null)[];
  footLabel: string;
  barLabel: (t: ReturnType<typeof tally>) => string;
  tools?: ReactNode;
  legend: readonly { swatch: JournalCell; label: string }[];
}) {
  const n = props.questions;
  const compact = n > COMPACT_AFTER;
  const sides = [...props.before, ...props.after];
  const fixed =
    NUMBER_WIDTH + NAME_WIDTH + sides.reduce((s, c) => s + c.width, 0);
  const qWidth = compact
    ? `calc(100cqw - ${fixed}px)`
    : `min(34px, max(${MIN_CELL}px, calc((100cqw - ${fixed}px) / ${n})))`;
  const numbered = (i: number) =>
    n <= NUMBERED_EVERY || i === 0 || (i + 1) % 5 === 0;
  const sideCol = (c: JournalColumn, i: number) => (
    <col key={i} style={{ width: c.width }} />
  );

  return (
    <div className="j-panel">
      <div className="j-strip">
        {props.tools}
        <ul className="j-legend">
          {props.legend.filter(shown(compact)).map((l) => (
            <li key={l.label}>
              <Cell cell={l.swatch} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="j-scroll">
        <table
          className="j-table"
          data-variant={props.variant}
          data-compact={compact || undefined}
        >
          <colgroup>
            <col style={{ width: NUMBER_WIDTH }} />
            <col style={{ width: NAME_WIDTH }} />
            {props.before.map(sideCol)}
            {compact ? (
              <col style={{ width: qWidth }} />
            ) : (
              Array.from({ length: n }, (_, i) => (
                <col key={i} style={{ width: qWidth }} />
              ))
            )}
            {props.after.map(sideCol)}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="j-n" />
              <th>{m.col_student()}</th>
              {props.before.map((c, i) => (
                <th key={i} className={c.className}>
                  {c.head}
                </th>
              ))}
              {compact ? (
                <th className="j-q">{m.col_questions({ count: n })}</th>
              ) : (
                Array.from({ length: n }, (_, i) => (
                  <th key={i} className="j-q">
                    {numbered(i) ? i + 1 : ""}
                  </th>
                ))
              )}
              {props.after.map((c, i) => (
                <th key={i} className={c.className}>
                  {c.head}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r, i) => (
              <tr key={r.key} data-tone={r.tone}>
                <td className="j-n">{i + 1}</td>
                <td className="j-name">{r.name}</td>
                {r.before}
                {compact ? (
                  <td className="j-q">
                    <Bar cells={r.cells} label={props.barLabel} />
                  </td>
                ) : (
                  r.cells.map((c, q) => (
                    <td key={q} className="j-q">
                      <Cell cell={c} />
                    </td>
                  ))
                )}
                {r.after}
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td colSpan={1 + props.before.length}>{props.footLabel}</td>
              {compact ? (
                <td className="j-q">
                  <span className="j-hist">
                    {props.pct.map((p, q) => (
                      <Pct key={q} pct={p} number={q + 1} />
                    ))}
                  </span>
                </td>
              ) : (
                props.pct.map((p, q) => (
                  <td key={q} className="j-q j-q-pct">
                    {n <= PCT_AS_TEXT ? (
                      <span className="j-pct" data-low={low(p)}>
                        {p === null ? "—" : `${p}%`}
                      </span>
                    ) : (
                      <Pct pct={p} number={q + 1} />
                    )}
                  </td>
                ))
              )}
              <td colSpan={props.after.length + 1} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Cell({ cell }: { cell: JournalCell }) {
  return (
    <span
      className="j-cell"
      data-state={cell.state}
      data-overridden={cell.overridden || undefined}
      data-late={cell.late || undefined}
    >
      {cell.text}
    </span>
  );
}

/** A question's percent as a small upright bar, for footers too narrow for text. */
function Pct({ pct, number }: { pct: number | null; number: number }) {
  return (
    <span
      className="j-mini"
      data-low={low(pct)}
      title={`${number}: ${pct === null ? "—" : `${pct}%`}`}
    >
      <i style={{ "--j-pct": `${pct ?? 0}%` } as CSSProperties} />
    </span>
  );
}

/** A row's cells as one bar: full points, fewer points, answered, the rest. */
function Bar(props: {
  cells: JournalCell[];
  label: (t: ReturnType<typeof tally>) => string;
}) {
  const t = tally(props.cells.map((c) => c.state));
  const label = props.label(t);
  return (
    <span className="j-bar" role="img" aria-label={label} title={label}>
      <i data-state="good" style={{ flexGrow: t.good }} />
      <i data-state="bad" style={{ flexGrow: t.bad }} />
      <i data-state="answered" style={{ flexGrow: t.answered }} />
      <i data-state="left" style={{ flexGrow: t.left }} />
    </span>
  );
}
