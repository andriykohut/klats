/**
 * Where an autosave stands: everything is saved, a change is waiting or
 * being sent, or the last attempt failed and a retry is due.
 */
export type SaveState = "saved" | "saving" | "retrying";

export interface Autosave<T> {
  /** Takes the newest value; it is saved once no change has come for the delay. */
  change(value: T): void;
  /**
   * Saves the newest value now. Resolves once everything is saved, or
   * rejects with the error of the next failed attempt.
   */
  flush(): Promise<void>;
  /**
   * Sends what is pending at once and stops retrying failed saves, for when
   * the editor goes away; a save already sent still completes.
   */
  stop(): void;
  /** Undoes {@link stop}, for an editor that comes back, as React's StrictMode remounts it. */
  start(): void;
}

/**
 * Saves the newest value `delay` ms after the last change, one request at a
 * time: a change made while a save is in flight goes out after it completes.
 * A failed save keeps its value (or a newer one) and is retried after 1, 2
 * and 4 s, then every 5 s, until one succeeds; a new change retries sooner.
 */
export function autosave<T, R>(opts: {
  save: (value: T) => Promise<R>;
  onSaved: (result: R) => void;
  onState: (state: SaveState) => void;
  delay?: number;
}): Autosave<T> {
  const { save, onSaved, onState, delay = 400 } = opts;
  let next: T | undefined;
  let dirty = false;
  let busy = false;
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiters: { resolve: () => void; reject: (err: unknown) => void }[] = [];

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, ms);
  };

  const settle = (err?: unknown) => {
    const all = waiters;
    waiters = [];
    for (const w of all) {
      if (err === undefined) w.resolve();
      else w.reject(err);
    }
  };

  async function run() {
    if (busy || !dirty) return;
    busy = true;
    dirty = false;
    const value = next as T;
    try {
      onSaved(await save(value));
      failures = 0;
    } catch (err) {
      if (!dirty) {
        next = value;
        dirty = true;
      }
      busy = false;
      failures++;
      onState("retrying");
      settle(err ?? new Error("save failed"));
      if (!stopped) schedule(Math.min(1000 * 2 ** (failures - 1), 5000));
      return;
    }
    busy = false;
    if (dirty) {
      // A pending timer means the teacher is still typing; it sends the rest.
      if (!timer) void run();
      return;
    }
    onState("saved");
    settle();
  }

  const flush = () => {
    if (!dirty && !busy) return Promise.resolve();
    const done = new Promise<void>((resolve, reject) =>
      waiters.push({ resolve, reject }),
    );
    clearTimeout(timer);
    timer = undefined;
    void run();
    return done;
  };

  return {
    change(value) {
      next = value;
      dirty = true;
      if (failures === 0) onState("saving");
      schedule(delay);
    },
    flush,
    stop() {
      stopped = true;
      flush().catch(() => {});
    },
    start() {
      stopped = false;
    },
  };
}
