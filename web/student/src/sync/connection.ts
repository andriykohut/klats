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

/** How a pass of requests ended: "refused" is an HTTP error response. */
type Outcome = "ok" | "failed" | "refused" | "stopped";

/**
 * Sends an {@link AnswerQueue}'s changes to the server and keeps the device's
 * place in the sitting alive with heartbeats.
 *
 * Each cycle submits every pending change in chunks of 100, then heartbeats,
 * then submits what was set during the heartbeat. Cycles run every 5 s while
 * online. Only one request is in flight at a time, so a heartbeat's `pending`
 * counts every unacked change, and a submit's counts those left after it.
 *
 * A request fails on a network error, or when no response arrives within 8 s,
 * which also aborts it. Two consecutive failures mean offline; then cycles
 * retry after 1, 2, 4 and 8 s, then every 8 s, and the first that gets
 * through runs in the same order, flushing before the heartbeat. An HTTP
 * error response is not a failure: the changes stay queued and the cycle
 * retries on the same backoff, without changing the state. A 403 `kicked` is
 * reported to {@link Connection.onStatus} as the status `kicked`. Acked
 * changes leave the queue, including ones the server rejected, which are
 * never resent.
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
   * queue untouched, so another tab can take the queue over. Pending
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
   * `http://10.0.0.5:8080`, and runs a cycle there at once.
   */
  setBase(url: string): void {
    this.base = url;
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
    while (this.running && this.want !== "none") {
      const beat = this.want === "cycle";
      this.want = "none";
      clearTimeout(this.timer);
      const outcome = await this.pass(beat);
      if (this.running) this.schedule(outcome);
    }
    this.busy = false;
  }

  private async pass(beat: boolean): Promise<Outcome> {
    let outcome = await this.flushAll();
    if (outcome === "ok" && beat) {
      outcome = await this.heartbeat();
      if (outcome === "ok") outcome = await this.flushAll();
    }
    return outcome;
  }

  private schedule(outcome: Outcome): void {
    const backoff = outcome === "refused" || this.state === "offline";
    const delay = backoff
      ? BACKOFF_MS[Math.min(this.retries++, BACKOFF_MS.length - 1)]
      : HEARTBEAT_MS;
    this.timer = setTimeout(() => this.kick(true), delay);
  }

  private async flushAll(): Promise<Outcome> {
    for (let left = this.queue.pending(); left.length > 0; ) {
      const changes = left.slice(0, CHUNK);
      const req = { changes, pending: left.length - changes.length };
      const res = await this.send((signal) =>
        this.transport.submit(this.base, req, signal),
      );
      if (typeof res === "string") return res;
      this.queue.ack(res.acks);
      this.succeeded();
      this.report(res.status);
      left = this.queue.pending();
    }
    return "ok";
  }

  private async heartbeat(): Promise<Outcome> {
    const req = { pending: this.queue.pending().length };
    const res = await this.send((signal) =>
      this.transport.heartbeat(this.base, req, signal),
    );
    if (typeof res === "string") return res;
    this.succeeded();
    this.report(res);
    return "ok";
  }

  /**
   * Runs one request with the timeout. It returns the response, or the
   * outcome that ends the pass, having counted a failure if it was one.
   */
  private async send<T extends object>(
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | Outcome> {
    if (!this.running) return "stopped";
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("timed out"));
      }, TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([call(abort.signal), timeout]);
      return this.running ? res : "stopped";
    } catch (err) {
      if (!this.running) return "stopped";
      if (!(err instanceof ApiError)) {
        this.failed();
        return "failed";
      }
      if (err.status === 403 && err.code === "kicked") {
        this.report({ state: "kicked" });
      }
      return "refused";
    } finally {
      clearTimeout(timer);
    }
  }

  private succeeded(): void {
    this.failures = 0;
    this.retries = 0;
    if (this.state === "offline") this.state = "syncing";
    this.emit();
  }

  private failed(): void {
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
      this.stateListener?.(this.state, pending);
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
    this.statusListener?.({
      state: s.state,
      remainingMs: s.remainingMs ?? undefined,
      result: s.result ?? undefined,
    });
  }
}
