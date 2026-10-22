import type {
  JoinInfo,
  NameEntry,
  Participant,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { motion, useReducedMotionConfig } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "react-aria-components/Button";
import {
  RadioButton,
  RadioField,
  RadioGroup,
} from "react-aria-components/RadioGroup";
import { NameTaken, pick, streaming } from "../api";
import { ApiError } from "../sync/connection";
import { errorText, Problem, Sheet } from "./ui";

/** How often the list is fetched again while the event stream is closed. */
const REFRESH_MS = 15_000;

/**
 * The class list as name tiles, with a filter field for long lists: the
 * free names in the server's order, as a radio group, then «Уже приєднались»
 * with the names other computers hold, as plain buttons. The list follows
 * `info` as it changes, sliding names between the groups, but holds every
 * change while a pointer is down on it or a pick is on its way (and after it
 * succeeded, until the screen leaves), and keeps keyboard focus on the same
 * name. Pressing a held name (click, tap, Enter or Space; arrows never reach
 * it) sends its pick at once, so the server refuses it with the holding
 * computer's label and alerts the teacher, or lets the student join if the
 * name was freed meanwhile. `onRefresh` fetches the list again; it runs
 * every 15 s and after a refused pick, but only while the event stream that
 * carries the changes is closed.
 */
export function PickName({
  code,
  info,
  onPicked,
  onRefresh,
  onBack,
}: {
  code: string;
  info: JoinInfo;
  onPicked: (p: Participant) => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const reduced = useReducedMotionConfig();
  const [names, setNames] = useState(info.names);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const pressing = useRef(false);
  const picking = useRef(false);
  const held = useRef<NameEntry[] | null>(null);
  const focused = useRef<string | null>(null);

  // Applies a held change once nothing holds the list any more.
  const release = () => {
    if (pressing.current || picking.current || !held.current) return;
    setNames(held.current);
    held.current = null;
  };

  useEffect(() => {
    if (pressing.current || picking.current) held.current = info.names;
    else setNames(info.names);
  }, [info.names]);

  useEffect(() => {
    const up = () => {
      pressing.current = false;
      release();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!streaming()) onRefresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [onRefresh]);

  // A name moving to the other group is re-inserted, which drops its focus.
  useLayoutEffect(() => {
    const id = focused.current;
    if (!id || list.current?.contains(document.activeElement)) return;
    list.current
      ?.querySelector<HTMLElement>(
        `[data-student="${CSS.escape(id)}"] :is(input, button)`,
      )
      ?.focus({ preventScroll: true });
  }, [names]);

  const q = query.trim().toLocaleLowerCase("uk");
  const shown = names.filter((n) => n.name.toLocaleLowerCase("uk").includes(q));
  const free = shown.filter((n) => !n.taken);
  const taken = shown.filter((n) => n.taken);
  const isTaken = (id: string | null) =>
    names.some((n) => n.studentId === id && n.taken);
  // Someone else took the picked name since.
  const lost = isTaken(selected);
  const move = reduced
    ? { duration: 0 }
    : { type: "spring" as const, visualDuration: 0.45, bounce: 0.15 };

  /**
   * Picks the name. For a held name the server refuses with the label of the
   * computer that holds it and alerts the teacher; a 429 then gets the line
   * without the label. The list stays as it is meanwhile, and for good once
   * the pick succeeds: the server already counts this student's own name as
   * taken.
   */
  const send = async (id: string) => {
    if (picking.current) return;
    picking.current = true;
    setBusy(true);
    setError(null);
    try {
      onPicked(await pick(code, { studentId: id }));
    } catch (err) {
      const limited = err instanceof ApiError && err.status === 429;
      setError(limited && isTaken(id) ? m.pick_taken_plain() : errorText(err));
      setBusy(false);
      picking.current = false;
      release();
      if (err instanceof NameTaken && !streaming()) onRefresh();
    }
  };

  const face = (n: NameEntry) => (
    <span className="k-face">
      <span className="k-badge k-badge-single" aria-hidden="true">
        <span className="k-badge-dot" />
      </span>
      <span className="k-tile-text">{n.name}</span>
    </span>
  );
  // One layoutId per name, so a name slides from one group to the other.
  const wrap = (n: NameEntry, children: ReactNode) => (
    <motion.div
      key={n.studentId}
      layoutId={n.studentId}
      layout="position"
      transition={move}
      className="k-tile-wrap"
      data-student={n.studentId}
      data-taken={n.taken || undefined}
    >
      {children}
    </motion.div>
  );

  return (
    <Sheet className="s-pick">
      <div className="s-pick-head">
        <h1 className="s-h1">{m.pick_title()}</h1>
        <input
          className="s-field s-search"
          type="search"
          placeholder={m.pick_search()}
          aria-label={m.pick_search()}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <motion.div
        className="s-names-scroll"
        layoutScroll
        ref={list}
        // Capture: React Aria stops a pressed tile's pointerdown from bubbling.
        onPointerDownCapture={() => {
          pressing.current = true;
        }}
        onFocus={(e) => {
          focused.current =
            (e.target as Element)
              .closest("[data-student]")
              ?.getAttribute("data-student") ?? null;
        }}
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null;
          if (to && !list.current?.contains(to)) focused.current = null;
        }}
      >
        <RadioGroup
          className="s-names"
          aria-label={m.pick_title()}
          value={lost ? null : selected}
          onChange={(id) => {
            setSelected(id);
            setError(null);
          }}
        >
          {free.map((n) =>
            wrap(
              n,
              <RadioField value={n.studentId} className="k-tile-field">
                <RadioButton className="k-tile">{face(n)}</RadioButton>
              </RadioField>,
            ),
          )}
        </RadioGroup>
        {taken.length > 0 && (
          <>
            <motion.h2
              layout="position"
              transition={move}
              className="s-names-head"
            >
              {m.pick_joined()}
            </motion.h2>
            <div className="s-names">
              {taken.map((n) =>
                wrap(
                  n,
                  <Button
                    className="k-tile"
                    isDisabled={busy}
                    onPress={() => void send(n.studentId)}
                  >
                    {face(n)}
                  </Button>,
                ),
              )}
            </div>
          </>
        )}
        {shown.length === 0 && <p className="s-empty">{m.pick_none()}</p>}
      </motion.div>
      <div className="s-foot">
        <button type="button" className="s-btn s-btn-quiet" onClick={onBack}>
          <span>{m.back()}</span>
        </button>
        {(error || lost) && <Problem>{error ?? m.pick_taken_plain()}</Problem>}
        <button
          type="button"
          className="s-btn"
          disabled={!selected || lost || busy}
          onClick={() => selected && !lost && send(selected)}
        >
          <span>{m.pick_start()}</span>
        </button>
      </div>
    </Sheet>
  );
}
