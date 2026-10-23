import type { Answer } from "@klats/shared/generated/testfmt.ts";
import type {
  AnswerChange,
  StoredAnswer,
} from "@klats/shared/generated/wire.ts";
import { readStored } from "./storage";

/** What an {@link AnswerQueue} keeps in storage under its key. */
interface Saved {
  v: 2;
  /** The seq base of the last restore, which every change must exceed. */
  seqBase: number;
  answers: StoredAnswer[];
  pending: AnswerChange[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): boolean =>
  Array.isArray(value) && value.every((s) => typeof s === "string");

const isAnswerValue = (value: unknown): value is Answer =>
  isObject(value) &&
  (value.items === undefined || isStrings(value.items)) &&
  (value.pairs === undefined ||
    (isObject(value.pairs) &&
      Object.values(value.pairs).every((s) => typeof s === "string"))) &&
  (value.text === undefined || typeof value.text === "string") &&
  (value.point === undefined ||
    (isObject(value.point) &&
      typeof value.point.x === "number" &&
      typeof value.point.y === "number"));

const isRow = (value: unknown): boolean => {
  const r = value as StoredAnswer | null;
  return (
    typeof r?.questionId === "string" &&
    typeof r.seq === "number" &&
    isAnswerValue(r.answer)
  );
};

const isChange = (value: unknown): value is AnswerChange => {
  const c = value as AnswerChange | null;
  return (
    isRow(value) &&
    typeof c?.changeId === "string" &&
    typeof c.participantId === "string"
  );
};

const isSaved = (value: unknown): value is Saved => {
  const s = value as Saved | null;
  return (
    s?.v === 2 &&
    typeof s.seqBase === "number" &&
    Array.isArray(s.answers) &&
    s.answers.every(isRow) &&
    Array.isArray(s.pending) &&
    s.pending.every(isChange)
  );
};

/**
 * A participant's answers on this device and the changes the server has not
 * acknowledged yet, saved to storage after every write so a reload or crash
 * loses nothing. One queue holds one participant: the caller keys the storage
 * by participant id, and every change carries that id.
 *
 * Each question numbers its changes with a `seq` that only goes up, across
 * reloads and {@link AnswerQueue.restore}, because the server keeps the
 * change with the highest seq. Every change also exceeds the seq base the
 * last restore was given: the server's `TestResponse.seqBase`, which rises by
 * a million each time the teacher moves the student to another device. The
 * device moved off numbers its changes from the previous base, so as long as
 * fewer than a million changes are made to one question between two moves,
 * whatever the student answers on the new device outranks every change the
 * old one still holds, and the old device's leftovers only fill questions
 * the new one never answered. A queue that is `set` before any restore
 * starts at seq 1.
 *
 * Only the newest unacked change of a question is pending: a newer one
 * replaces it, since the server would ignore the older one anyway.
 *
 * Unreadable stored state is copied to `<key>.bad` and the queue starts
 * empty. When a write to storage fails, the queue keeps working from memory,
 * logs the failure once and sets {@link AnswerQueue.saveFailed}; every later
 * write retries.
 */
export class AnswerQueue {
  private readonly storage: Storage;
  private readonly key: string;
  private readonly participantId: string;
  private readonly answers: Map<string, StoredAnswer>;
  private changes: AnswerChange[];
  private seqBase: number;
  private failed = false;

  /** Loads what `storage` holds under `key`, or starts empty. */
  constructor(storage: Storage, key: string, participantId: string) {
    this.storage = storage;
    this.key = key;
    this.participantId = participantId;
    const saved = readStored(storage, key, isSaved);
    this.answers = new Map(saved?.answers.map((a) => [a.questionId, a]));
    this.changes = saved?.pending ?? [];
    this.seqBase = saved?.seqBase ?? 0;
  }

  /**
   * True while the last write to storage failed: the answers are kept in
   * memory only, and a reload now would lose what was not saved.
   */
  get saveFailed(): boolean {
    return this.failed;
  }

  /**
   * Records the answer to a question and returns the change to send, which
   * replaces any unacked change of that question.
   */
  set(questionId: string, answer: Answer): AnswerChange {
    const last = this.answers.get(questionId)?.seq ?? 0;
    const seq = Math.max(last, this.seqBase) + 1;
    const change: AnswerChange = {
      changeId: newChangeId(),
      participantId: this.participantId,
      questionId,
      answer,
      seq,
    };
    this.answers.set(questionId, { questionId, answer, seq });
    this.changes = this.changes.filter((c) => c.questionId !== questionId);
    this.changes.push(change);
    this.save();
    return change;
  }

  /** Returns the unacked changes, oldest first, at most one per question. */
  pending(): AnswerChange[] {
    return [...this.changes];
  }

  /** Drops the changes with these ids; unknown ids are ignored. */
  ack(changeIds: string[]): void {
    const acked = new Set(changeIds);
    this.changes = this.changes.filter((c) => !acked.has(c.changeId));
    this.save();
  }

  /** Returns the answer recorded for a question, or undefined if none. */
  current(questionId: string): Answer | undefined {
    return this.answers.get(questionId)?.answer;
  }

  /**
   * Merges the answers the server holds. A local answer with a higher seq
   * than the server's stays, and stays pending; otherwise the server's answer
   * and seq replace it and its unacked change is dropped. Questions the server
   * does not list keep their local answer. Every later change, to any
   * question, exceeds `seqBase` (the server's `TestResponse.seqBase`).
   */
  restore(server: StoredAnswer[], seqBase: number): void {
    this.seqBase = seqBase;
    for (const s of server) {
      if ((this.answers.get(s.questionId)?.seq ?? 0) > s.seq) continue;
      this.answers.set(s.questionId, s);
      this.changes = this.changes.filter((c) => c.questionId !== s.questionId);
    }
    this.save();
  }

  private save(): void {
    const saved: Saved = {
      v: 2,
      seqBase: this.seqBase,
      answers: [...this.answers.values()],
      pending: this.changes,
    };
    try {
      this.storage.setItem(this.key, JSON.stringify(saved));
      this.failed = false;
    } catch (err) {
      if (!this.failed) console.error("Answers could not be saved", err);
      this.failed = true;
    }
  }
}

/** Returns 16 random bytes as lowercase hex. */
function newChangeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
