import type {
  HeartbeatRequest,
  Status,
  SubmitRequest,
  SubmitResult,
} from "@klats/shared/generated/wire.ts";
import type { AnswerQueue } from "./queue";

/** Changes per submit; the server refuses more than 200. */
const CHUNK = 100;
const HEARTBEAT_MS = 5000;
/** Waits between retries while offline or after an HTTP error; the last repeats. */
const BACKOFF_MS = [1000, 2000, 4000, 8000];
const TIMEOUT_MS = 8000;
/** Consecutive network failures that mean offline. */
const OFFLINE_AFTER = 2;
/** The abort reason of a request {@link Connection.setBase} gives up on. */
const MOVED = new Error("moved to a new address");

/**
 * What the student sees of the connection, as ConnectionToast takes it:
 * `syncing` means the server answers again after an outage and the queue
 * is not drained yet.
 */
export type ConnectionState = "online" | "offline" | "syncing";

/**
 * An HTTP error response from the student API: its status and the `error`
 * code of its body. A {@link Transport} rejects with it so a {@link Connection}
 * can tell a server that answered from a network that did not.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`HTTP ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

/**
 * The two student API calls a {@link Connection} makes. `base` is the
 * teacher's origin, such as `http://10.0.0.5:8080`, or `''` for the page's
 * own; the paths are `/api/answers` and `/api/heartbeat`. Each call rejects
 * with an {@link ApiError} for an HTTP error response and with anything else
 * when no response arrived. `signal` aborts when the Connection gives up on
 * the request; pass it to fetch.
 */
export interface Transport {
  submit(
    base: string,
    req: SubmitRequest,
    signal: AbortSignal,
  ): Promise<SubmitResult>;
  heartbeat(
    base: string,
    req: HeartbeatRequest,
    signal: AbortSignal,
  ): Promise<Status>;
}

/**
 * Sends an {@link AnswerQueue}'s changes to the server and keeps the device's
 * place in the sitting alive with heartbeats.
 *
 * Each cycle submits every pending change in chunks of 100, then heartbeats,
 * then, if both went through, submits what was set during the heartbeat. A
 * refused submit does not hold the heartbeat back; after a failed one the
 * heartbeat is skipped, so a cycle counts at most one failure. Cycles run
 * every 5 s while online, counted from the last pass the server accepted;
 * submits between cycles that fail or are refused never put the next cycle
 * off. Only one request is in flight at a time, so a heartbeat's `pending`
 * counts every unacked change, and a submit's counts those left after it.
 *
 * A request fails on a network error, or when no response arrives within 8 s,
 * which also aborts it. Two consecutive failures mean offline; then cycles
 * retry after 1, 2, 4 and 8 s, then every 8 s, and the first that gets
 * through runs in the same order, flushing before the heartbeat. An HTTP
 * error response is not a failure: the changes stay queued and cycles retry
 * on the same backoff, without changing the state. Acked changes leave the
 * queue, including ones the server rejected, which are never resent.
 *
 * A `kicked` status, or a 403 `kicked`, stops the Connection for good: it is
 * reported once to {@link Connection.onStatus}, waiting drains resolve false
 * and nothing more is sent. An error thrown by a listener or inside a cycle
 * is logged with `console.error` and never stops syncing.
 */
export class Connection {
  private readonly transport: Transport;
  private readonly queue: AnswerQueue;
  private base = "";
  private state: ConnectionState = "online";
  private failures = 0;
  private retries = 0;
  private running = false;
  private busy = false;
  private want: "none" | "flush" | "cycle" = "none";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  /** Whether the current pass sent a request. */
  private sent = false;
  /**
   * Whether the current pass got an HTTP error response, or threw: the next
   * cycle then backs off.
   */
  private refused = false;
  /** Whether a request of the current pass failed (a network failure). */
  private dropped = false;
  private reported: { state: ConnectionState; pending: number } | undefined;
  private stateListener:
    | ((state: ConnectionState, pending: number) => void)
    | undefined;
  private statusListener: ((status: Status) => void) | undefined;
  private drains: ((drained: boolean) => void)[] = [];

  constructor(transport: Transport, queue: AnswerQueue) {
    this.transport = transport;
    this.queue = queue;
  }

  /** Reports the current state and pending count, then runs a cycle at once. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit();
    this.kick(true);
  }

  /**
   * Stops all requests. A response still in flight is ignored and leaves the
   * queue untouched, so another tab can take the queue over. Waiting
   * {@link Connection.drain} calls resolve false.
   */
  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.settleDrains();
  }

  /**
   * Call after each `queue.set`: reports the new pending count to
   * {@link Connection.onState} and, unless offline, submits it now, or right
   * after the request in flight.
   */
  flush(): void {
    this.emit();
    if (this.state !== "offline") this.kick(false);
  }

  /**
   * Points requests at the teacher's new origin, such as
   * `http://10.0.0.5:8080`. A request in flight to the old one is aborted,
   * without counting as a failure, and a cycle runs at the new one at once.
   */
  setBase(url: string): void {
    this.base = url;
    this.request?.abort(MOVED);
    this.kick(true);
  }

  /**
   * Runs a cycle now instead of at the next 5 s tick, such as when the server
   * hints that the device's status changed. A cycle in flight finishes first,
   * so requests never overlap. Does nothing once stopped.
   */
  heartbeatNow(): void {
    this.kick(true);
  }

  /**
   * Resolves true once no change is left unacked (at once if none is), and
   * false if the connection is offline or stops first. It submits pending
   * changes now if it can.
   */
  drain(): Promise<boolean> {
    return new Promise((resolve) => {
      this.drains.push(resolve);
      this.flush();
    });
  }

  /**
   * Sets the one listener for state and pending count. It is called on
   * {@link Connection.start} and whenever either changes.
   */
  onState(cb: (state: ConnectionState, pending: number) => void): void {
    this.stateListener = cb;
  }

  /**
   * Sets the one listener for the statuses submit and heartbeat responses
   * carry. Fields the server sends as null arrive as undefined.
   */
  onStatus(cb: (status: Status) => void): void {
    this.statusListener = cb;
  }

  private kick(beat: boolean): void {
    if (!this.running) return;
    if (beat) this.want = "cycle";
    else if (this.want === "none") this.want = "flush";
    if (!this.busy) void this.run();
  }

  private async run(): Promise<void> {
    this.busy = true;
    try {
      while (this.running && this.want !== "none") {
        const beat = this.want === "cycle";
        this.want = "none";
        if (beat) clearTimeout(this.timer);
        this.sent = false;
        this.refused = false;
        this.dropped = false;
        try {
          await this.pass(beat);
        } catch (err) {
          console.error(err);
          this.refused = true;
        }
        // A flush pass moves the next cycle's deadline only when the server
        // took what it sent: one that sent nothing, or failed, or was refused
        // leaves it, so answering quickly never holds the heartbeat back.
        const took = this.sent && !this.refused && !this.dropped;
        if (this.running && (beat || took)) this.schedule();
      }
    } finally {
      this.busy = false;
    }
  }

  private async pass(beat: boolean): Promise<void> {
    const flushed = await this.flushAll();
    // After a network failure the heartbeat could not get through either, and
    // counting it too would let one blip mean offline.
    if (!beat || this.dropped || this.want === "cycle") return;
    if ((await this.heartbeat()) && flushed) await this.flushAll();
  }

  /**
   * Sets the next cycle's timer, unless a cycle is already queued: by
   * setBase, or by the timer firing during a flush pass.
   */
  private schedule(): void {
    if (this.want === "cycle") return;
    clearTimeout(this.timer);
    let delay = HEARTBEAT_MS;
    if (this.refused || this.state === "offline") {
      delay = BACKOFF_MS[Math.min(this.retries++, BACKOFF_MS.length - 1)];
    } else {
      this.retries = 0;
    }
    this.timer = setTimeout(() => this.kick(true), delay);
  }

  /** Submits pending changes in chunks; returns whether none is left. */
  private async flushAll(): Promise<boolean> {
    for (let left = this.queue.pending(); left.length > 0; ) {
      const changes = left.slice(0, CHUNK);
      const req = { changes, pending: left.length - changes.length };
      const res = await this.send((signal) =>
        this.transport.submit(this.base, req, signal),
      );
      if (!res) return false;
      this.queue.ack(res.acks);
      this.succeeded();
      // A finish waiting on the drain resumes after this report; app.ts relies on it.
      this.report(res.status);
      left = this.queue.pending();
    }
    return true;
  }

  private async heartbeat(): Promise<boolean> {
    const req = { pending: this.queue.pending().length };
    const res = await this.send((signal) =>
      this.transport.heartbeat(this.base, req, signal),
    );
    if (!res) return false;
    this.succeeded();
    this.report(res);
    return true;
  }

  /**
   * Runs one request with the timeout. It returns the response, or undefined
   * when there is none to use: a failure (counted), an HTTP error, a stop, or
   * an abort by setBase.
   */
  private async send<T>(
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.running) return undefined;
    this.sent = true;
    const request = new AbortController();
    this.request = request;
    const { signal } = request;
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    const timer = setTimeout(
      () => request.abort(new Error("timed out")),
      TIMEOUT_MS,
    );
    try {
      const res = await Promise.race([call(signal), aborted]);
      return this.running ? res : undefined;
    } catch (err) {
      if (!this.running || signal.reason === MOVED) return undefined;
      if (!(err instanceof ApiError)) this.failed();
      else if (err.status === 403 && err.code === "kicked") {
        this.report({ state: "kicked" });
      } else this.refused = true;
      return undefined;
    } finally {
      clearTimeout(timer);
      this.request = undefined;
    }
  }

  private succeeded(): void {
    this.failures = 0;
    if (this.state === "offline") this.state = "syncing";
    this.emit();
  }

  private failed(): void {
    this.dropped = true;
    if (++this.failures >= OFFLINE_AFTER) this.state = "offline";
    this.emit();
  }

  /** Tells the listener the state and pending count if either changed. */
  private emit(): void {
    const pending = this.queue.pending().length;
    if (this.state === "syncing" && pending === 0) this.state = "online";
    const last = this.reported;
    if (last?.state !== this.state || last.pending !== pending) {
      this.reported = { state: this.state, pending };
      safely(this.stateListener, this.state, pending);
    }
    this.settleDrains();
  }

  private settleDrains(): void {
    let drained: boolean;
    if (this.queue.pending().length === 0) drained = true;
    else if (!this.running || this.state === "offline") drained = false;
    else return;
    for (const resolve of this.drains.splice(0)) resolve(drained);
  }

  private report(s: Status): void {
    if (s.state === "kicked") this.stop();
    safely(this.statusListener, {
      state: s.state,
      remainingMs: s.remainingMs ?? undefined,
      result: s.result ?? undefined,
    });
  }
}

/** Calls a listener, logging what it throws so it cannot stop syncing. */
function safely<A extends unknown[]>(
  listener: ((...args: A) => void) | undefined,
  ...args: A
): void {
  try {
    listener?.(...args);
  } catch (err) {
    console.error(err);
  }
}
