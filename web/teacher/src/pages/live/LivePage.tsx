import type { LiveRow, LiveSnapshot } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Dialog,
  FieldError,
  Form,
  Heading,
  Input,
  Label,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  SwitchButton,
  SwitchField,
  TextField,
} from "react-aria-components";
import { busy, useKick, useLive, useRenameDevice } from "../../api/queries";
import { Banners } from "../../ui/Banners";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { TopBar } from "../../ui/TopBar";
import { BoardView } from "./BoardView";
import { EventsPanel } from "./EventsPanel";
import {
  type JournalColumn,
  type JournalRow,
  JournalTable,
} from "./JournalTable";
import { band, initials } from "./journal";
import { LiveTopBar } from "./LiveTopBar";
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

const LIVE_LEGEND = () => [
  { state: "correct", label: m.live_legend_correct() },
  { state: "wrong", label: m.live_legend_wrong() },
  { state: "current", label: m.live_legend_current() },
];

const HIDDEN_LEGEND = () => [
  { state: "answered", label: m.live_legend_answered() },
  { state: "current", label: m.live_legend_current() },
];

function Live({ snap }: { snap: LiveSnapshot }) {
  const [hidden, setHidden] = useState(hiddenAtStart);
  const [board, setBoard] = useState(false);
  const [kicking, setKicking] = useState<LiveRow | null>(null);
  const [renaming, setRenaming] = useState<LiveRow | null>(null);
  const kick = useKick();
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
    { head: m.col_status(), width: 170, flex: true },
    { head: m.col_grade(), width: 64, className: "j-grade" },
  ];
  // The server refuses kicks and renames once the sitting has ended.
  if (!ended) after.push({ head: "", width: 44 });

  const rows: JournalRow[] = snap.rows.map((r) => {
    const clash = clashed.has(r.participantId);
    return {
      key: r.participantId,
      name: who(r.name),
      tone: clash ? "clash" : r.status === "offline" ? "offline" : undefined,
      cells: r.cells.map((state) => ({
        state:
          hidden && (state === "correct" || state === "wrong")
            ? "answered"
            : state,
      })),
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
          {r.grade != null && !hidden && (
            <span className="j-gr" data-band={band(r.grade)}>
              {r.grade}
            </span>
          )}
        </td>,
        ...(ended
          ? []
          : [
              <td key="menu" className="j-act">
                <RowMenu
                  name={who(r.name)}
                  onKick={() => setKicking(r)}
                  onRename={() => setRenaming(r)}
                />
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
        />
      </div>
      <BoardView
        isOpen={board && !ended}
        onClose={() => setBoard(false)}
        code={snap.sitting.code}
        finished={snap.counts.finished}
        total={snap.counts.inTest}
      />
      <ConfirmDialog
        isOpen={kicking !== null}
        onOpenChange={(open) => !open && setKicking(null)}
        title={m.live_kick_title({ name: kicking?.name ?? "" })}
        confirm={m.live_kick()}
        pending={kick.isPending}
        onConfirm={() => {
          if (!kicking || busy("kick")) return;
          kick.mutate(kicking.participantId, {
            onSuccess: () => setKicking(null),
          });
        }}
      >
        {m.live_kick_text()}
      </ConfirmDialog>
      {renaming && (
        <RenameDialog row={renaming} onClose={() => setRenaming(null)} />
      )}
    </div>
  );
}

function StatusChip({ row, clash }: { row: LiveRow; clash: boolean }) {
  if (clash) {
    return (
      <span className="j-chip" data-tone="red">
        {m.status_clash()}
      </span>
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

/** The «⋯» button of a row: disconnect the student, rename the computer. */
function RowMenu(props: {
  name: string;
  onKick: () => void;
  onRename: () => void;
}) {
  return (
    <MenuTrigger>
      <Button
        className="t-icon-btn j-menu-btn"
        aria-label={m.live_row_menu({ name: props.name })}
      >
        <Icon name="more" />
      </Button>
      <Popover placement="bottom end" className="j-menu-pop">
        <Menu
          className="j-menu"
          onAction={(key) =>
            key === "kick" ? props.onKick() : props.onRename()
          }
        >
          <MenuItem id="rename" className="j-menu-item">
            {m.live_rename()}
          </MenuItem>
          <MenuItem id="kick" className="j-menu-item j-menu-danger">
            {m.live_kick()}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

const MAX_LABEL = 20;

/** Renames the computer of `row`; the label is 1 to 20 characters. */
function RenameDialog({ row, onClose }: { row: LiveRow; onClose: () => void }) {
  const rename = useRenameDevice();
  const [label, setLabel] = useState(row.deviceLabel);
  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className="t-scrim"
    >
      <Modal className="t-modal">
        <Dialog className="t-dialog">
          <Heading slot="title">{m.live_rename()}</Heading>
          <p>{m.live_rename_text()}</p>
          <Form
            className="l-rename"
            onSubmit={(e) => {
              e.preventDefault();
              const v = label.trim();
              if (v === "" || v.length > MAX_LABEL || busy("renameDevice")) {
                return;
              }
              rename.mutate(
                { token: row.deviceToken, label: v },
                { onSuccess: onClose },
              );
            }}
          >
            <TextField
              className="t-field"
              value={label}
              onChange={setLabel}
              maxLength={MAX_LABEL}
              isRequired
              autoFocus
              validate={(v) =>
                v.trim() === "" ? m.live_rename_invalid() : null
              }
            >
              <Label>{m.live_rename_label()}</Label>
              <Input />
              <FieldError />
            </TextField>
            <div className="t-dialog-actions">
              <Button slot="close" className="t-btn" data-variant="quiet">
                {m.action_cancel()}
              </Button>
              <Button
                type="submit"
                className="t-btn"
                data-variant="teal"
                isPending={rename.isPending}
              >
                {m.action_save()}
              </Button>
            </div>
          </Form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
