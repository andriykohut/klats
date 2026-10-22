import "@klats/shared/fonts.css";
import "@klats/shared/tokens.css";
import "./app.css";
import type {
  FinishResult,
  JoinInfo,
  Participant,
  Status,
  StudentTest,
  TestResponse,
} from "@klats/shared/generated/wire.ts";
import {
  applyPalette,
  PALETTES,
  type PaletteId,
} from "@klats/shared/palettes.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { isLocale, setLocale } from "@klats/shared/paraglide/runtime.js";
import { ConnectionToast } from "@klats/shared/student-ui/ConnectionToast.tsx";
import { FinishScreen } from "@klats/shared/student-ui/FinishScreen.tsx";
import { Progress } from "@klats/shared/student-ui/Progress.tsx";
import { AnimatePresence, MotionConfig } from "motion/react";
import { Fragment, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import * as api from "./api";
import { watchFocus } from "./input/focus";
import { AddressChanged } from "./screens/AddressChanged";
import { JoinCode } from "./screens/JoinCode";
import { Kicked, Moved } from "./screens/Kicked";
import { OtherTab } from "./screens/OtherTab";
import { PickName } from "./screens/PickName";
import { Review } from "./screens/Review";
import { TakeTest } from "./screens/TakeTest";
import { TypedName } from "./screens/TypedName";
import { ApiError, Connection, type ConnectionState } from "./sync/connection";
import { AnswerQueue } from "./sync/queue";
import { readStored } from "./sync/storage";
import { claimTab } from "./sync/tabs";

/*
 * The student app: a small state machine of screens over one store. Plain
 * functions below move it (join, answer, finish, and the statuses the server
 * reports); React only draws the current state. A Connection syncs the answer
 * queue of the participant this device writes as, from the moment the test
 * loads until the server has every answer, or the student is sent away.
 */

type Screen =
  | { name: "boot" }
  | { name: "join"; code: string }
  | { name: "pick"; code: string; info: JoinInfo }
  | { name: "typed"; code: string }
  | { name: "test" }
  | { name: "review" }
  | { name: "finish" }
  | { name: "kicked" }
  | { name: "moved" }
  | { name: "otherTab" }
  | { name: "address"; back: Screen };

interface State {
  screen: Screen;
  lang: string;
  /** The test being written; null before it loads. */
  test: StudentTest | null;
  title: string;
  name: string;
  /** The question on screen, from 0. */
  index: number;
  /** The picked option ids per question id, as the queue holds them. */
  answers: Record<string, string[]>;
  net: { state: ConnectionState; pending: number };
  saveFailed: boolean;
  result: FinishResult | null;
}

/** What survives a reload, under `klats.participant`. */
interface Saved {
  id: string;
  name: string;
  title: string;
  palette: string;
  index: number;
}

const SAVED = "klats.participant";
const LANG = "klats.lang";

const isSaved = (v: unknown): v is Saved => {
  const s = v as Saved | null;
  return (
    typeof s?.id === "string" &&
    typeof s.name === "string" &&
    typeof s.title === "string" &&
    typeof s.palette === "string" &&
    typeof s.index === "number"
  );
};

let state: State = {
  screen: { name: "boot" },
  lang: "uk",
  test: null,
  title: "",
  name: "",
  index: 0,
  answers: {},
  net: { state: "online", pending: 0 },
  saveFailed: false,
  result: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let saved = readStored(localStorage, SAVED, isSaved);

function save(patch: Partial<Saved>): void {
  if (!saved) return;
  saved = { ...saved, ...patch };
  try {
    localStorage.setItem(SAVED, JSON.stringify(saved));
  } catch {
    // Full storage: the queue warns the student; this only costs the place.
  }
}

/** The participant whose answers sync; null whenever no Connection runs. */
let session: { queue: AnswerQueue; conn: Connection } | null = null;
let unwatch: (() => void) | null = null;
/** The join code, for picking a name again after a kick. */
let joinCode = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// shortcut: each participant's queue stays in localStorage after the test
// (a few KB per sitting); prune old klats.answers.* keys if lab PCs fill up.
const queueKey = (id: string) => `klats.answers.${id}`;

function show(screen: Screen): void {
  const writing = ["test", "review", "address"].includes(screen.name);
  if (writing) unwatch ??= watchFocus(api.reportFocus);
  else {
    unwatch?.();
    unwatch = null;
  }
  update({ screen });
}

function paint(palette: string): void {
  const id = Object.hasOwn(PALETTES, palette) ? palette : "teal";
  applyPalette(document.documentElement, id as PaletteId);
}

function setLang(lang: string): void {
  if (!isLocale(lang)) return;
  setLocale(lang, { reload: false });
  document.documentElement.lang = lang;
  localStorage.setItem(LANG, lang);
  update({ lang });
}

/**
 * Resolves `call` once it gets through, retrying network failures after 1,
 * 2, 4, then every 8 s. An HTTP error rejects at once.
 */
async function retry<T>(call: () => Promise<T>): Promise<T> {
  for (let wait = 1000; ; wait = Math.min(wait * 2, 8000)) {
    try {
      return await call();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      await sleep(wait);
    }
  }
}

/** Starts syncing the participant's queue, after merging `res` into it. */
function sync(id: string, res?: TestResponse): AnswerQueue {
  end();
  const queue = new AnswerQueue(localStorage, queueKey(id), id);
  // Before any set, so every change outranks what a device the student was
  // moved off still holds.
  if (res) queue.restore(res.answers, res.seqBase);
  const conn = new Connection(api.transport, queue);
  const s = { queue, conn };
  session = s;
  conn.onState((st, pending) => update({ net: { state: st, pending } }));
  conn.onStatus((st) => {
    if (session === s) void follow(st);
  });
  conn.start();
  return queue;
}

function end(): void {
  session?.conn.stop();
  session = null;
}

/**
 * Loads the test this device writes and shows it where the student left off.
 * `name` is the name just picked; after a reload the saved one is used.
 */
async function resume(name?: string): Promise<void> {
  let res: TestResponse;
  try {
    res = await retry(api.loadTest);
  } catch (err) {
    const kicked = err instanceof ApiError && err.status === 403;
    return show(kicked ? { name: "kicked" } : { name: "join", code: "" });
  }
  const { participantId: id, test } = res;
  if (saved?.id !== id) {
    saved = { id, name: name ?? "", title: "", palette: "", index: 0 };
  }
  save({ title: test.title, palette: test.palette, ...(name && { name }) });
  // shortcut: the test lives in memory only; a reload needs the teacher's
  // server anyway (no service worker on plain HTTP). Revisit if offline
  // reloads become possible.
  const queue = sync(id, res);
  paint(test.palette);
  update({
    test,
    title: test.title,
    name: saved?.name ?? "",
    index: Math.min(saved?.index ?? 0, test.questions.length - 1),
    answers: Object.fromEntries(
      test.questions.map((q) => [q.id, queue.current(q.id) ?? []]),
    ),
    saveFailed: queue.saveFailed,
    result: null,
  });
  if (res.status.state === "writing") show({ name: "test" });
  else await follow(res.status);
}

/** Moves the app to where the server's status for this device says it is. */
async function follow(st: Status): Promise<void> {
  const at = state.screen.name;
  if (at === "otherTab") return;
  switch (st.state) {
    case "writing":
      if (!session) await resume();
      return;
    case "finished":
    case "ended":
      // A result means the server holds every answer it will grade.
      if (st.result) {
        end();
        update({ result: st.result });
      }
      if (at !== "finish") show({ name: "finish" });
      return;
    case "kicked":
      end();
      return show({ name: "kicked" });
    case "moved":
      if (at !== "moved") {
        show({ name: "moved" });
        void stopWhenDrained();
      }
      return;
    default:
      end();
      if (at === "pick") await rejoin();
      else if (at !== "join" && at !== "typed") {
        show({ name: "join", code: "" });
      }
  }
}

/**
 * Keeps sending what the queue holds after a move, since the server still
 * takes it from this device, then stops.
 */
async function stopWhenDrained(): Promise<void> {
  const s = session;
  while (s && session === s && !(await s.conn.drain())) await sleep(5000);
  if (s && session === s) end();
}

/** Asks the server for the class list again and shows it, or the code. */
async function rejoin(): Promise<void> {
  try {
    joined(joinCode, await api.join(joinCode));
  } catch {
    show({ name: "join", code: "" });
  }
}

function joined(code: string, info: JoinInfo): void {
  joinCode = code;
  setLang(info.language);
  show(
    info.mode === "list"
      ? { name: "pick", code, info }
      : { name: "typed", code },
  );
}

function picked(p: Participant): Promise<void> {
  return resume(p.name);
}

function answer(questionId: string, optionIds: string[]): void {
  if (!session) return;
  session.queue.set(questionId, optionIds);
  session.conn.flush();
  update({
    answers: { ...state.answers, [questionId]: optionIds },
    saveFailed: session.queue.saveFailed,
  });
  save({ index: state.index });
}

function go(index: number): void {
  update({ index });
  save({ index });
  show({ name: "test" });
}

/**
 * Finishes the test: once the server holds every answer, it records the
 * finish and shows the grade. Offline, the finish screen waits, and it all
 * completes on reconnect.
 */
async function finishTest(): Promise<void> {
  const s = session;
  if (!s) return;
  update({ result: null });
  show({ name: "finish" });
  // Finishing locks the answers, so nothing may be left unsent.
  while (session === s && !(await s.conn.drain())) await sleep(2000);
  if (session !== s) return;
  try {
    const result = await retry(api.finish);
    if (session !== s) return;
    await s.conn.drain();
    end();
    update({ result });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      await follow({ state: "kicked" });
    }
    // Any other refusal leaves the heartbeat to report what became of it.
  }
}

/** A hint from the event stream that this device's status changed. */
function onHint(): void {
  if (session) session.conn.heartbeatNow();
  else api.heartbeat(0).then(follow, () => {});
}

function changeAddress(url: string, back: Screen): void {
  api.setBase(url);
  session?.conn.setBase(url);
  api.listen(onHint);
  show(back);
}

function lostTab(): void {
  end();
  show({ name: "otherTab" });
}

/**
 * Starts the app: claims the tab, then asks the server where this device
 * stands, sending what a reload left in the queue, and goes there.
 */
async function boot(): Promise<void> {
  setLang(localStorage.getItem(LANG) ?? "uk");
  paint("teal");
  if (!claimTab("klats.tab", lostTab)) return show({ name: "otherTab" });
  api.listen(onHint);
  const queue =
    saved && new AnswerQueue(localStorage, queueKey(saved.id), saved.id);
  const pending = queue ? queue.pending().length : 0;
  const [st] = await Promise.all([
    retry(() => api.heartbeat(pending)),
    fonts(),
  ]);
  if (saved && ["finished", "ended", "moved"].includes(st.state)) {
    paint(saved.palette);
    update({ title: saved.title, name: saved.name });
    sync(saved.id);
  }
  if (st.state === "unjoined") {
    show({
      name: "join",
      code: new URLSearchParams(location.search).get("code") ?? "",
    });
  } else await follow(st);
}

/**
 * Loads the text and display fonts, so the first sheet measures its answers
 * in them. It gives up after 1.5 s and draws with the fallbacks.
 */
function fonts(): Promise<unknown> {
  const load = Promise.all([
    document.fonts.load("700 20px Manrope", "Аa"),
    document.fonts.load("800 20px Unbounded", "Аa1"),
  ]).then(() => document.fonts.ready);
  return Promise.race([load.catch(() => {}), sleep(1500)]);
}

/** Screens of a loaded test, which show its title and the connection. */
const TEST_SCREENS = new Set(["test", "review", "finish", "address"]);

function App() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  const { screen, test } = s;
  const inTest = TEST_SCREENS.has(screen.name) && s.title !== "";
  const offline = s.net.state === "offline";

  let content = null;
  switch (screen.name) {
    case "join":
      content = <JoinCode key="join" initial={screen.code} onJoined={joined} />;
      break;
    case "pick":
      content = (
        <PickName
          key="pick"
          code={screen.code}
          info={screen.info}
          onPicked={picked}
          onBack={() => show({ name: "join", code: "" })}
        />
      );
      break;
    case "typed":
      content = (
        <TypedName
          key="typed"
          code={screen.code}
          onPicked={picked}
          onBack={() => show({ name: "join", code: "" })}
        />
      );
      break;
    case "test":
      if (test) {
        content = (
          <TakeTest
            key={test.questions[s.index].id}
            test={test}
            index={s.index}
            answers={s.answers}
            onAnswer={answer}
            onGo={go}
            onReview={() => show({ name: "review" })}
          />
        );
      }
      break;
    case "review":
      if (test) {
        content = (
          <Review
            key="review"
            test={test}
            answers={s.answers}
            onGo={go}
            onBack={() => show({ name: "test" })}
            onFinish={finishTest}
          />
        );
      }
      break;
    case "finish":
      content = <FinishScreen key="finish" result={s.result} />;
      break;
    case "kicked":
      content = <Kicked key="kicked" onPick={rejoin} />;
      break;
    case "moved":
      content = <Moved key="moved" />;
      break;
    case "otherTab":
      content = <OtherTab key="otherTab" />;
      break;
    case "address":
      content = (
        <AddressChanged
          key="address"
          onConnect={(url) => changeAddress(url, screen.back)}
          onCancel={() => show(screen.back)}
        />
      );
      break;
  }

  return (
    <Fragment key={s.lang}>
      <div className="s-top">
        {inTest ? (
          <div className="s-title">{s.title}</div>
        ) : (
          <div className="s-brand">{m.app_name()}</div>
        )}
        {test && (screen.name === "test" || screen.name === "review") && (
          <Progress
            answered={test.questions.map(
              (q) => (s.answers[q.id]?.length ?? 0) > 0,
            )}
            current={screen.name === "test" ? s.index : -1}
            onJump={go}
          />
        )}
        {/* shortcut: no timer chip beside the name, as this version has no
            time limits and Status.remainingMs is always null; add it here
            with them. */}
        <div className="s-who">{inTest && s.name}</div>
      </div>
      {inTest && (
        <ConnectionToast
          state={s.net.state}
          pending={s.net.pending}
          action={
            offline &&
            screen.name !== "address" && (
              <button
                type="button"
                className="s-toast-link"
                onClick={() => show({ name: "address", back: screen })}
              >
                {m.address_link()}
              </button>
            )
          }
        />
      )}
      <main className="s-slot">
        <AnimatePresence mode="wait">{content}</AnimatePresence>
      </main>
      {s.saveFailed && <p className="s-note">{m.save_failed()}</p>}
    </Fragment>
  );
}

// The old-browser notice in index.html is showing: this browser lacks what
// the app needs, so it never starts.
if (document.getElementById("old")?.hidden) {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>,
  );
  void boot();
}
