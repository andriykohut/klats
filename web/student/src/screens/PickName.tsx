import type {
  JoinInfo,
  NameEntry,
  Participant,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
 * free names in the server's order, then «Уже приєднались» with the names
 * other computers hold. The list follows `info` as it changes, sliding
 * names between the groups, but holds a change while a pointer is down on
 * it and keeps keyboard focus on the same name. Tapping a held name sends its
 * pick at once, so the server refuses it with the holding computer's label
 * and alerts the teacher (or, if the name was freed meanwhile, the student
 * joins). `onRefresh` fetches the list again; it
 * runs every 15 s and after a refused pick, but only while the event stream
 * that carries the changes is closed.
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
  const held = useRef<NameEntry[] | null>(null);
  const focused = useRef<string | null>(null);

  useEffect(() => {
    if (pressing.current) held.current = info.names;
    else setNames(info.names);
  }, [info.names]);

  useEffect(() => {
    const release = () => {
      pressing.current = false;
      if (held.current) setNames(held.current);
      held.current = null;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
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
      ?.querySelector<HTMLElement>(`[data-student="${CSS.escape(id)}"] input`)
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
   * without the label.
   */
  const send = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      onPicked(await pick(code, { studentId: id }));
    } catch (err) {
      const limited = err instanceof ApiError && err.status === 429;
      setError(limited && isTaken(id) ? m.pick_taken_plain() : errorText(err));
      setBusy(false);
      if (err instanceof NameTaken && !streaming()) onRefresh();
    }
  };

  const tile = (n: NameEntry) => (
    <motion.div
      key={n.studentId}
      layout="position"
      transition={move}
      className="k-tile-wrap"
      data-student={n.studentId}
      data-taken={n.taken || undefined}
    >
      <RadioField value={n.studentId} className="k-tile-field">
        <RadioButton className="k-tile">
          <span className="k-face">
            <span className="k-badge k-badge-single" aria-hidden="true">
              <span className="k-badge-dot" />
            </span>
            <span className="k-tile-text">{n.name}</span>
          </span>
        </RadioButton>
      </RadioField>
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
            if (!isTaken(id)) {
              setSelected(id);
              setError(null);
            } else if (!busy) void send(id);
          }}
        >
          {free.map(tile)}
          {taken.length > 0 && (
            <motion.p
              key="taken"
              layout="position"
              transition={move}
              className="s-names-head"
            >
              {m.pick_joined()}
            </motion.p>
          )}
          {taken.map(tile)}
        </RadioGroup>
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
