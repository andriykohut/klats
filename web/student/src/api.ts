import type {
  FinishResult,
  JoinInfo,
  NamesTaken,
  Participant,
  Status,
  TestResponse,
} from "@klats/shared/generated/wire.ts";
import { ApiError, type Transport } from "./sync/connection";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TIMEOUT_MS = 8000;

/** Returns `bytes` in lowercase RFC 4648 base32, without padding. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    for (; bits >= 5; bits -= 5) out += ALPHABET[(value >>> (bits - 5)) & 31];
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

let token: string | undefined;

/**
 * Returns this browser's device token: 16 random bytes in base32, made on
 * the first visit and kept in localStorage as `klats.device`. The server
 * ties the student's name to it.
 */
function device(): string {
  token ??= localStorage.getItem("klats.device") ?? undefined;
  if (!token || !/^[a-z2-7]{26}$/.test(token)) {
    token = base32(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem("klats.device", token);
  }
  return token;
}

/** The teacher's origin every call goes to; `''` is the page's own. */
let base = "";

/** The teacher's origin calls go to now; `''` is the page's own. */
export const apiBase = (): string => base;

/** Points every later call, and the next {@link listen}, at `url`. */
export function setBase(url: string): void {
  base = url;
}

/** The 409 of a name pick while another computer holds the name. */
export class NameTaken extends ApiError {
  /** The label of the computer that holds the name. */
  readonly label: string;

  constructor(label: string) {
    super(409, "name_taken");
    this.label = label;
  }
}

/**
 * Calls the student API at `base` with the device header: a POST of `body`,
 * or a GET without one. It resolves to the JSON reply, and rejects with an
 * {@link ApiError} ({@link NameTaken} for a taken name) for an HTTP error
 * and with anything else when no reply came: a network failure, or none
 * within 8 s.
 */
async function call<T>(
  at: string,
  path: string,
  body?: unknown,
  signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS),
): Promise<T> {
  const res = await fetch(at + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-Klats-Device": device(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (data.error === "name_taken") throw new NameTaken(String(data.label));
  throw new ApiError(res.status, String(data.error ?? ""));
}

export const join = (code: string) =>
  call<JoinInfo>(base, "/api/join", { code });

/** Picks a class-list student by id, or a typed name when `studentId` is empty. */
export const pick = (
  code: string,
  name: {
    studentId?: string;
    surname?: string;
    firstName?: string;
    className?: string;
  },
) =>
  call<Participant>(base, "/api/pick", {
    code,
    studentId: "",
    surname: "",
    firstName: "",
    className: "",
    ...name,
  });

export const loadTest = () => call<TestResponse>(base, "/api/test");

export const heartbeat = (pending: number) =>
  call<Status>(base, "/api/heartbeat", { pending });

export const finish = () => call<FinishResult>(base, "/api/finish", {});

/** Reports that the student left the page or came back; failures are ignored. */
export function reportFocus(left: boolean): void {
  // shortcut: a report that fails, such as during an outage, is dropped, so
  // the teacher's window switch count can be low; queue them if that matters.
  call(base, "/api/focus", { left }).catch(() => {});
}

/** The answer and heartbeat calls the Connection makes. */
export const transport: Transport = {
  submit: (at, req, signal) => call(at, "/api/answers", req, signal),
  heartbeat: (at, req, signal) => call(at, "/api/heartbeat", req, signal),
};

let stream: EventSource | undefined;

/**
 * Opens the device's event stream at `base`, closing any earlier one, and
 * calls `onStatus` on each hint that the device's status changed. With
 * `names`, it also streams the taken names of that class-list sitting to
 * `names.onTaken`, as the ids of the students devices hold.
 *
 * The stream is closed for good on its first error: the server refuses more
 * than 64 streams per address with a 429, after which EventSource never
 * retries, and the 5 s heartbeat reports every status anyway.
 */
export function listen(
  onStatus: () => void,
  names?: { sitting: string; onTaken: (taken: string[]) => void },
): void {
  stream?.close();
  const sitting = names ? `&sitting=${encodeURIComponent(names.sitting)}` : "";
  const es = new EventSource(`${base}/api/events?device=${device()}${sitting}`);
  es.addEventListener("status", onStatus);
  if (names) {
    es.addEventListener("taken", (e) => {
      const data: Partial<NamesTaken> = JSON.parse(e.data);
      if (Array.isArray(data.taken)) names.onTaken(data.taken);
    });
  }
  es.onerror = () => {
    es.close();
    if (stream === es) stream = undefined;
  };
  stream = es;
}

/** Whether the event stream is open or opening, so its events can arrive. */
export const streaming = () => stream !== undefined;

/**
 * Returns the teacher's address typed by a student as an origin,
 * `http://host` or `http://host:port`: an IPv4 address or a host name, an
 * optional port from 1 to 65535, an optional `http://` in front and `/` at
 * the end. It returns null for anything else, an empty input included.
 */
export function normalizeAddress(input: string): string | null {
  // shortcut: IPv6 addresses are refused, as school LANs hand out IPv4;
  // accept [addr]:port when a lab runs without IPv4.
  const m = /^(?:http:\/\/)?([a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(
    input.trim(),
  );
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = m[2] === undefined ? undefined : Number(m[2]);
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  const ipv4 = /^[\d.]+$/.test(host);
  const parts = host.split(".");
  const valid = ipv4
    ? parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && +p < 256)
    : parts.every((p) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(p));
  if (!valid) return null;
  return port === undefined ? `http://${host}` : `http://${host}:${port}`;
}
