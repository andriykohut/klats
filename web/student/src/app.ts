import { isAnswered } from "@klats/shared/answers.ts";
import { hasCode } from "@klats/shared/code/registry.ts";
import type { Answer } from "@klats/shared/generated/testfmt.ts";
import type {
  FinishResult,
  JoinInfo,
  Participant,
  Status,
  StudentTest,
  TestResponse,
} from "@klats/shared/generated/wire.ts";
import { hasMath } from "@klats/shared/math/registry.ts";
import {
  applyPalette,
  PALETTES,
  type PaletteId,
} from "@klats/shared/palettes.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { isLocale, setLocale } from "@klats/shared/paraglide/runtime.js";
import * as api from "./api";
import { loadHighlighter } from "./code";
import { watchFocus } from "./input/focus";
import { loadMath } from "./math";
import { preloadMedia, releaseMedia, retryMedia } from "./media";
import { route } from "./route";
import { ApiError, Connection, type ConnectionState } from "./sync/connection";
import { AnswerQueue } from "./sync/queue";
import { readStored } from "./sync/storage";
import { claimTab } from "./sync/tabs";

/*
 * The student app: a small state machine of screens over one store. Plain
 * functions below move it (join, answer, finish, and the statuses the server
 * reports); React, in main.tsx, only draws the current state. A Connection
 * syncs the answer queue of the participant this device writes as, from the
 * moment the test loads until the server has every answer, or the student is
 * sent away.
 */

type Screen =
  | { name: "boot" }
  | { name: "join"; code: string }
  | { name: "pick"; code: string; info: JoinInfo }
  | { name: "typed"; code: string; info: JoinInfo }
  | { name: "test" }
  | { name: "review" }
  | { name: "finish" }
  | { name: "kicked" }
  | { name: "moved" }
  | { name: "otherTab" }
  | { name: "unreachable" }
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
  /** The newest answer the student gave to each question, by question id, as the queue holds it. */
  answers: Record<string, Answer>;
  net: { state: ConnectionState; pending: number };
  saveFailed: boolean;
  result: FinishResult | null;
  /** On the moved screen: the server holds every change this device made. */
  drained: boolean;
  /** When the time limit runs out, as a performance.now() time; null without one. */
  deadline: number | null;
  /** The time left at the last tick of the countdown. */
  remainingMs: number;
  /** The time ran out: answers are locked, and the finish screen says so. */
  timeUp: boolean;
}

/** What survives a reload, under `klats.participant`. */
interface Saved {
  id: string;
  /** The join code, for picking a name again after a kick. */
  code: string;
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
    typeof s.code === "string" &&
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
  drained: false,
  deadline: null,
  remainingMs: 0,
  timeUp: false,
};
const listeners = new Set<() => void>();

function update(patch: Partial<State>): void {
  state = { ...state, ...patch };
  pollPending();
  runClock();
  for (const l of listeners) l();
}

/** How often the countdown ticks. */
const CLOCK_MS = 500;
let clock: ReturnType<typeof setInterval> | undefined;

/**
 * Keeps the countdown ticking while the test or the review shows and the test
 * has a time limit. It runs on performance.now(), so a wrong or changed lab
 * PC clock cannot stretch it, and it runs on offline.
 */
function runClock(): void {
  const on =
    state.deadline !== null &&
    (state.screen.name === "test" || state.screen.name === "review");
  if (on && clock === undefined) clock = setInterval(tick, CLOCK_MS);
  else if (!on && clock !== undefined) {
    clearInterval(clock);
    clock = undefined;
  }
}

/** Redraws the time left, or at the deadline locks the answers and finishes. */
function tick(): void {
  const left = (state.deadline ?? 0) - performance.now();
  if (left > 0) update({ remainingMs: left });
  else {
    update({ remainingMs: 0, timeUp: true });
    void finishTest();
  }
}

/** A status has given the test this page loaded time left; see {@link finishTest}. */
let hadTime = false;

/**
 * Counts down from the time left that the server's status `st` carries, if
 * any. More time, such as the teacher's «+5 хв», unlocks the answers again
 * until the finish is sent (see {@link finishTest}).
 */
function count(st: Status): void {
  const ms = st.remainingMs;
  // A status straight from the API, not through the Connection, has null.
  if (typeof ms !== "number") return;
  if (ms > 0) hadTime = true;
  update({
    deadline: performance.now() + ms,
    remainingMs: ms,
    timeUp: ms <= 0,
  });
}

/** How often a finish screen with a pending grade asks the server whether it is graded. */
const PENDING_POLL_MS = 10_000;
let pendingPoll: ReturnType<typeof setInterval> | undefined;

/**
 * Keeps a poll running while the finish screen shows a pending grade and no
 * session syncs. The event stream announces the teacher's grade, but it closes
 * for good on its first error, so the poll is what delivers it after a drop.
 */
function pollPending(): void {
  const waiting =
    state.screen.name === "finish" && !!state.result?.pending && !session;
  if (waiting && pendingPoll === undefined) {
    pendingPoll = setInterval(() => {
      api.heartbeat(0).then(follow, () => {});
    }, PENDING_POLL_MS);
  } else if (!waiting && pendingPoll !== undefined) {
    clearInterval(pendingPoll);
    pendingPoll = undefined;
  }
}

/** Subscribes to state changes, as useSyncExternalStore takes it. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current state, as useSyncExternalStore reads it. */
export const getState = (): State => state;

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
/** The join code of this session; see {@link rejoin} for after a reload. */
let joinCode = "";
/** The class-list sitting whose taken names the event stream carries. */
let namesSitting = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// shortcut: each participant's queue stays in localStorage after the test
// (a few KB per sitting); prune old klats.answers.* keys if lab PCs fill up.
const queueKey = (id: string) => `klats.answers.${id}`;

export function show(screen: Screen): void {
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
  document.title = m.app_name();
  try {
    localStorage.setItem(LANG, lang);
  } catch {
    // Full storage: the next boot starts in the default language.
  }
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
  conn.onState((st, pending) => {
    if (st === "online" && state.net.state !== "online") retryMedia();
    update({ net: { state: st, pending } });
  });
  conn.onStatus((st) => {
    if (session === s) void follow(st);
  });
  conn.start();
  return queue;
}

/**
 * Loads KaTeX when `test` has formulas. It is not retried: when the load
 * fails, the formulas keep showing their LaTeX source.
 */
function loadFormulas(test: StudentTest): void {
  if (hasMath(test)) loadMath().catch(() => {});
}

/**
 * Loads the code highlighter when `test` has a code block with a language. It
 * is not retried: when the load fails, code stays plain text.
 */
function loadHighlighting(test: StudentTest): void {
  if (hasCode(test)) loadHighlighter().catch(() => {});
}

function end(): void {
  session?.conn.stop();
  session = null;
  releaseMedia();
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
    saved = {
      id,
      code: "",
      name: name ?? "",
      title: "",
      palette: "",
      index: 0,
    };
  }
  save({
    title: test.title,
    palette: test.palette,
    ...(name && { name }),
    ...(joinCode && { code: joinCode }),
  });
  // shortcut: the test lives in memory only; a reload needs the teacher's
  // server anyway (no service worker on plain HTTP). Revisit if offline
  // reloads become possible.
  const queue = sync(id, res);
  preloadMedia(test);
  loadFormulas(test);
  loadHighlighting(test);
  paint(test.palette);
  const answers: Record<string, Answer> = Object.fromEntries(
    test.questions.map((q) => [q.id, queue.current(q.id) ?? {}]),
  );
  let index = saved?.index ?? 0;
  if (test.navigation === "forward") {
    // Never before the question after the last answer: a computer the
    // student was moved to has no saved place, and full storage loses saves.
    const last = test.questions.reduce(
      (l, q, i) => (isAnswered(q, answers[q.id]) ? i : l),
      -1,
    );
    index = Math.max(index, last + 1);
  }
  update({
    test,
    title: test.title,
    name: saved?.name ?? "",
    index: Math.min(index, test.questions.length - 1),
    answers,
    saveFailed: queue.saveFailed,
    result: null,
    deadline: null,
    timeUp: false,
  });
  hadTime = false;
  count(res.status);
  if (res.status.state === "writing") show({ name: "test" });
  else await follow(res.status);
}

/** Moves the app to where the server's status for this device says it is. */
async function follow(st: Status): Promise<void> {
  count(st);
  const step = route(st, state.screen.name, session !== null);
  switch (step.to) {
    case "resume":
      return resume();
    case "finish":
      // A result means the server holds every answer it will grade.
      if (step.result) {
        end();
        update({ result: step.result });
      }
      return show({ name: "finish" });
    case "kicked":
      end();
      return show({ name: "kicked" });
    case "moved":
      update({ drained: false });
      show({ name: "moved" });
      return stopWhenDrained();
    case "names":
      return refreshNames();
    case "join":
      end();
      return show({ name: "join", code: "" });
  }
}

/**
 * Keeps sending what the queue holds after a move, since the server still
 * takes it from this device, then stops.
 */
async function stopWhenDrained(): Promise<void> {
  const s = session;
  while (s && session === s && !(await s.conn.drain())) await sleep(5000);
  if (s && session !== s) return;
  end();
  update({ drained: true });
}

/**
 * Shows the class list again for the join code of this session, or after a
 * reload the remembered one or the page's `?code=`; with no code, or when the
 * join fails, it shows the code screen.
 */
export async function rejoin(): Promise<void> {
  const code =
    joinCode ||
    saved?.code ||
    new URLSearchParams(location.search).get("code") ||
    "";
  try {
    joined(code, await api.join(code));
  } catch {
    show({ name: "join", code: "" });
  }
}

/** Fetches the class list again and shows it, if the student still chooses. */
export async function refreshNames(): Promise<void> {
  try {
    const info = await api.join(joinCode);
    if (state.screen.name === "pick") {
      show({ name: "pick", code: joinCode, info });
    }
  } catch {
    // A 429 or a failure skips this refresh; the next one comes.
  }
}

/** Marks the names other devices hold, as the event stream reports them. */
function onTaken(taken: string[]): void {
  const screen = state.screen;
  if (screen.name !== "pick") return;
  const held = new Set(taken);
  const names = screen.info.names.map((n) => ({
    ...n,
    taken: held.has(n.studentId),
  }));
  show({ ...screen, info: { ...screen.info, names } });
}

/** Opens the event stream, with the taken names while there is a class list. */
function openStream(): void {
  api.listen(
    onHint,
    namesSitting ? { sitting: namesSitting, onTaken } : undefined,
  );
}

export function joined(code: string, info: JoinInfo): void {
  joinCode = code;
  setLang(info.language);
  if (info.mode === "list" && info.sittingId !== namesSitting) {
    namesSitting = info.sittingId;
    openStream();
  }
  show(
    info.mode === "list"
      ? { name: "pick", code, info }
      : { name: "typed", code, info },
  );
}

export function picked(p: Participant): Promise<void> {
  return resume(p.name);
}

export function answer(questionId: string, a: Answer): void {
  if (!session || state.timeUp) return;
  session.queue.set(questionId, a);
  session.conn.flush();
  update({
    answers: { ...state.answers, [questionId]: a },
    saveFailed: session.queue.saveFailed,
  });
  save({ index: state.index });
}

export function go(index: number): void {
  update({ index });
  save({ index });
  show({ name: "test" });
}

/**
 * Finishes the test: once the server holds every answer, it records the
 * finish and shows the grade. Offline, the finish screen waits, and it all
 * completes on reconnect. A finish because the time ran out goes back to the
 * test instead when a status brings more than a second before it is sent. A
 * test that opened with no time left, such as on a computer that died across
 * the deadline, never sends it: the finish screen keeps syncing until the
 * teacher's «+5 хв» brings the test back or the sitting ends.
 */
export async function finishTest(): Promise<void> {
  const s = session;
  if (!s) return;
  const timed = state.timeUp;
  update({ result: null });
  show({ name: "finish" });
  // Finishing locks the answers, so nothing may be left unsent.
  while (session === s && (!(await s.conn.drain()) || (timed && !hadTime))) {
    await sleep(2000);
  }
  if (session !== s) return;
  if (timed) {
    // A status made just before the server's deadline must not flicker the test open.
    if (state.remainingMs > 1000) return show({ name: "test" });
    update({ timeUp: true });
  }
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

export function changeAddress(url: string, back: Screen): void {
  api.setBase(url);
  session?.conn.setBase(url);
  openStream();
  show(back);
}

function lostTab(): void {
  end();
  void boot();
}

/**
 * Starts the app: claims the tab, then finds where this device stands. While
 * another tab holds the claim it shows a notice and tries again every 5 s,
 * so a tab that crashed or was closed hands the test over.
 */
export async function boot(): Promise<void> {
  setLang(localStorage.getItem(LANG) ?? "uk");
  paint("teal");
  while (!claimTab("klats.tab", lostTab)) {
    show({ name: "otherTab" });
    await sleep(5000);
  }
  openStream();
  await locate();
}

/**
 * Asks the server where this device stands, sending what a reload left in
 * the queue, and goes there. When the server cannot be reached it says so,
 * with a way to try again.
 */
async function locate(): Promise<void> {
  show({ name: "boot" });
  const queue =
    saved && new AnswerQueue(localStorage, queueKey(saved.id), saved.id);
  const pending = queue ? queue.pending().length : 0;
  let st: Status;
  try {
    [st] = await Promise.all([api.heartbeat(pending), fonts()]);
  } catch {
    return show({ name: "unreachable" });
  }
  if (saved && ["finished", "ended", "moved"].includes(st.state)) {
    paint(saved.palette);
    update({ title: saved.title, name: saved.name });
    sync(saved.id);
  }
  if (st.state === "unjoined") {
    if (queue && pending > 0) await deliver(queue);
    show({
      name: "join",
      code: new URLSearchParams(location.search).get("code") ?? "",
    });
  } else await follow(st);
}

/**
 * Sends what a reload left in the queue of a participant this device no
 * longer writes as, such as after the next sitting started, since the server
 * still takes late answers for an older sitting. It gives up after 10 s, and
 * whatever is left stays stored for the next boot.
 */
async function deliver(queue: AnswerQueue): Promise<void> {
  const conn = new Connection(api.transport, queue);
  session = { queue, conn };
  conn.start();
  // The drain never settles while submits are refused, and settles as
  // offline only after two network failures, up to 21 s with timeouts.
  await Promise.race([conn.drain(), sleep(10_000)]);
  end();
}

/** Tries the server again; the event stream closed when it was not there. */
export function tryAgain(): Promise<void> {
  openStream();
  return locate();
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
