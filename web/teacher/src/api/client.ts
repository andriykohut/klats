import type { Problem, Test } from "@klats/shared/generated/testfmt.ts";
import type {
  AboutInfo,
  AssignmentResults,
  AssignmentSummary,
  Class,
  ClassSummary,
  ClientError,
  ExportResult,
  LiveSnapshot,
  MediaResult,
  NetworkInfo,
  OpenResult,
  OverrideRequest,
  SaveResult,
  SettingsInfo,
  SittingInfo,
  StartRequest,
  TestDoc,
  TestSummary,
} from "@klats/shared/generated/wire.ts";

/*
 * One function per teacher API route (internal/teacherapi). Every call is a
 * same-origin fetch: the launch-token cookie the server set on `/?t=` rides
 * along, so the app never sees the token.
 */

/**
 * An HTTP error from the teacher API. `code` is the body's `error`, such as
 * "not_found", "invalid", "sitting_active" or "unauthorized"; `problems` is
 * set for the 409 "has_problems" reply (wire ProblemsError) of a test that
 * cannot start.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problems?: Problem[];

  constructor(status: number, code: string, problems?: Problem[]) {
    super(`HTTP ${status} ${code}`);
    this.status = status;
    this.code = code;
    this.problems = problems;
  }
}

/**
 * Resolves to the JSON reply of `method path`, or undefined for a 204. It
 * rejects with an {@link ApiError} for an HTTP error, and with the fetch
 * error when the server cannot be reached.
 */
async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function send(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return res;
  throw await apiError(res);
}

async function apiError(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => ({}));
  return new ApiError(res.status, String(data.error ?? ""), data.problems);
}

const id = encodeURIComponent;

export const listTests = () => call<TestSummary[]>("GET", "/api/tests");
/** Creates an empty test; an empty title gets the server's default. */
export const createTest = (title: string) =>
  call<TestDoc>("POST", "/api/tests", { title });
export const getTest = (testId: string) =>
  call<TestDoc>("GET", `/api/tests/${id(testId)}`);
/** Saves the whole test. Problems never block a save; they come back in the result. */
export const saveTest = (testId: string, test: Test) =>
  call<SaveResult>("PUT", `/api/tests/${id(testId)}`, test);
export const deleteTest = (testId: string) =>
  call<void>("DELETE", `/api/tests/${id(testId)}`);
export const deleteAssignment = (assignmentId: string) =>
  call<void>("DELETE", `/api/assignments/${id(assignmentId)}`);
export const deleteParticipant = (
  assignmentId: string,
  participantId: string,
) =>
  call<void>(
    "DELETE",
    `/api/assignments/${id(assignmentId)}/participants/${id(participantId)}`,
  );
/** Stores a copy of the test, titled `title`, and resolves to the copy. */
export const duplicateTest = (testId: string, title: string) =>
  call<TestDoc>("POST", `/api/tests/${id(testId)}/duplicate`, { title });

/**
 * Exports the test as a .klats file, resolving as {@link exportResults} does.
 * A test whose pictures and sounds come to over 256 MB rejects with code
 * "too_large".
 */
export async function exportTest(
  testId: string,
): Promise<ExportResult | File | null> {
  const res = await send("POST", `/api/tests/${id(testId)}/export`, {});
  return exported(res, "test.klats");
}

/** The largest .klats or .mtf file the server opens: 256 MiB. */
const MAX_KLATS_BYTES = 256 * 2 ** 20;

/**
 * Opens a .klats file, or an .mtf file in the older format, as a new test and
 * resolves to it; a test from an .mtf file carries the notes of its
 * conversion. A file that is not a test rejects with an ApiError of code
 * "file_damaged", a test from a newer version with "test_too_new", an .mtf
 * file in the format's outdated layout with "file_too_old", and a file over
 * 256 MB with "too_large", which a file over {@link MAX_KLATS_BYTES} gets
 * without being sent.
 */
export async function importTest(file: File): Promise<TestDoc> {
  // The server's 413 cuts the upload short, which Firefox reports as a
  // network error and WebKit never settles.
  if (file.size > MAX_KLATS_BYTES) throw new ApiError(413, "too_large");
  const res = await fetch("/api/tests/import", { method: "POST", body: file });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

/**
 * Takes the oldest file the system opened Klats with, such as a double-clicked
 * .klats file, or resolves to null when none is waiting. A file over 256 MB
 * rejects with an ApiError of code "too_large", and one that can no longer be
 * read with "file_missing"; either way it is no longer waiting.
 */
export async function takeOpenedFile(): Promise<File | null> {
  const res = await send("GET", "/api/opened");
  if (res.status === 204) return null;
  const name = decodeURIComponent(res.headers.get("X-File-Name") ?? "");
  return new File([await res.blob()], name);
}

/**
 * Exports every test, class and result as a .klatsbackup file, resolving as
 * {@link exportResults} does. A running sitting rejects with code
 * "sitting_active", and data over 2 GB with "too_large".
 */
export async function exportBackup(): Promise<ExportResult | File | null> {
  const res = await send("POST", "/api/backup", {});
  return exported(res, "backup.klatsbackup");
}

/** The largest backup the server restores: 2 GiB. */
const MAX_BACKUP_BYTES = 2 * 2 ** 30;

/**
 * Replaces all the data with that of a .klatsbackup file. A running sitting
 * rejects with an ApiError of code "sitting_active", a file that is not a
 * backup with "file_damaged", one from a newer version with "backup_too_new",
 * and one over 2 GB with "too_large", which a file over
 * {@link MAX_BACKUP_BYTES} gets without being sent.
 */
export async function restoreBackup(file: File): Promise<void> {
  // The server's 413 cuts the upload short, which Firefox reports as a
  // network error and WebKit never settles.
  if (file.size > MAX_BACKUP_BYTES) throw new ApiError(413, "too_large");
  const res = await fetch("/api/backup/restore", {
    method: "POST",
    body: file,
  });
  if (!res.ok) throw await apiError(res);
}

/**
 * Stores an image or audio file and resolves to its media name. The server
 * sniffs the type from the bytes: a file it does not know rejects with an
 * ApiError of status 415 ("unsupported"), one over the size cap with 413
 * ("too_large").
 */
export async function postMedia(file: Blob): Promise<string> {
  const res = await fetch("/api/media", { method: "POST", body: file });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as MediaResult).name;
}

export const listClasses = () => call<ClassSummary[]>("GET", "/api/classes");
/** Creates a class; the reply lists the students in Ukrainian order. */
export const createClass = (c: Pick<Class, "name" | "students">) =>
  call<Class>("POST", "/api/classes", { id: "", ...c });
/** Returns the student names found in pasted text, in paste order. */
export const parseClass = (text: string) =>
  call<{ names: string[] }>("POST", "/api/classes/parse", { text });
export const getClass = (classId: string) =>
  call<Class>("GET", `/api/classes/${id(classId)}`);
/**
 * Renames the class and makes its students match `c.students`: students with
 * an id are renamed, those without one are added, and those left out are
 * removed. The reply lists them in Ukrainian order.
 */
export const saveClass = (c: Class) =>
  call<Class>("PUT", `/api/classes/${id(c.id)}`, c);
export const deleteClass = (classId: string) =>
  call<void>("DELETE", `/api/classes/${id(classId)}`);

/**
 * Starts a sitting. A test with blocking problems rejects with an ApiError
 * whose `problems` lists them; another running sitting rejects with code
 * "sitting_active".
 */
export const startSitting = (req: StartRequest) =>
  call<SittingInfo>("POST", "/api/sittings", req);

/**
 * Resolves to the live view of the running sitting, or of the last ended one
 * (`sitting.ended`), or to null when no sitting has run since launch.
 */
export async function live(): Promise<LiveSnapshot | null> {
  const snap = await call<LiveSnapshot>("GET", "/api/sittings/current");
  return snap.sitting.sittingId ? snap : null;
}

export const endSitting = () =>
  call<void>("POST", "/api/sittings/current/end", {});
export const kick = (participantId: string) =>
  call<void>("POST", `/api/participants/${id(participantId)}/kick`, {});
/** Moves a participant onto the device with token `device`. */
export const move = (participantId: string, device: string) =>
  call<void>("POST", `/api/participants/${id(participantId)}/move`, { device });
/**
 * Gives a writing participant `minutes` more time, 1 to 60. A participant who
 * is finished, kicked or in a test without a time limit rejects with an
 * ApiError.
 */
export const addTime = (participantId: string, minutes: number) =>
  call<void>("POST", `/api/participants/${id(participantId)}/time`, {
    minutes,
  });
/** Answers a pinned event with one of its `actions`. */
export const resolveEvent = (eventId: string, action: string) =>
  call<void>("POST", `/api/events/${id(eventId)}/resolve`, { action });
/** Renames a device; the label is 1 to 20 characters. */
export const renameDevice = (token: string, label: string) =>
  call<void>("PUT", `/api/devices/${id(token)}`, { label });

export const listAssignments = () =>
  call<AssignmentSummary[]>("GET", "/api/assignments");
export const results = (assignmentId: string) =>
  call<AssignmentResults>(
    "GET",
    `/api/assignments/${id(assignmentId)}/results`,
  );
/** Sets a question's points for a participant (clears the override when `points` is absent) and returns the new results. */
export const setOverride = (assignmentId: string, req: OverrideRequest) =>
  call<AssignmentResults>(
    "PUT",
    `/api/assignments/${id(assignmentId)}/overrides`,
    req,
  );

/**
 * Exports the results workbook. In the desktop app the teacher picks the file
 * in a save dialog: it resolves to where it was saved, or to null when the
 * dialog was cancelled. Without the desktop window (`klats -dev`) it resolves
 * to the workbook itself, named as the server names the download. A file that
 * cannot be replaced, such as one open in Excel, rejects with code
 * "write_failed".
 */
export async function exportResults(
  assignmentId: string,
): Promise<ExportResult | File | null> {
  const res = await send(
    "POST",
    `/api/assignments/${id(assignmentId)}/export`,
    {},
  );
  return exported(res, "results.xlsx");
}

/**
 * The reply of an export route: null for a cancelled save dialog, where the
 * dialog saved the file, or the downloaded file, named as the server names
 * it or else `fallback`.
 */
async function exported(
  res: Response,
  fallback: string,
): Promise<ExportResult | File | null> {
  if (res.status === 204) return null;
  if (res.headers.get("Content-Type")?.startsWith("application/json")) {
    return res.json();
  }
  const name = /filename\*=UTF-8''([^;]+)/.exec(
    res.headers.get("Content-Disposition") ?? "",
  );
  return new File(
    [await res.blob()],
    name ? decodeURIComponent(name[1]) : fallback,
  );
}

export const getNetwork = () => call<NetworkInfo>("GET", "/api/network");
/** Chooses the LAN address students use; it must be one of the candidates. */
export const setAddress = (address: string) =>
  call<NetworkInfo>("PUT", "/api/network", { address });
export const getSettings = () => call<SettingsInfo>("GET", "/api/settings");
/**
 * Saves the port, the language and the update switch together, so `s`
 * carries the current value of each one it does not change; a new port
 * applies at the next launch.
 */
export const saveSettings = (s: SettingsInfo) =>
  call<SettingsInfo>("PUT", "/api/settings", s);
export const getAbout = () => call<AboutInfo>("GET", "/api/about");
/** Asks GitHub for a newer release now; a failed check is an ApiError. */
export const checkUpdates = () => call<AboutInfo>("POST", "/api/updates/check");
/** Writes a crash of the app, with its stack and page, to the server's log. */
export const reportCrash = (c: ClientError) =>
  call<void>("POST", "/api/crash", c);

/**
 * Opens a page in the system browser: "download" is the Klats website's
 * download section in the UI language, "notes" the newer release's notes.
 * Without the desktop window (`klats -dev`) the page opens in a new tab. The
 * notes reject with code "not_found" until a newer release is known.
 */
export async function openLink(target: "download" | "notes"): Promise<void> {
  const res = await call<OpenResult | undefined>("POST", `/api/open/${target}`);
  if (res) window.open(res.url, "_blank", "noopener");
}
