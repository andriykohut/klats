import type {
  AnswerChange,
  StoredAnswer,
} from "@klats/shared/generated/wire.ts";
import { readStored } from "./storage";

/**
 * How far above the server's seqs a fresh device numbers its changes. A
 * device the student was moved off still holds its unsent answers, and their
 * seqs are at most its last synced seq plus its offline edits, far below a
 * million. Numbering the new device's changes from the server's seq plus this
 * gap means whatever the student answers there beats the old device's
 * leftovers, while those still fill the questions the new device has not
 * answered: the newest version wins, as the spec's merge requires. Seqs stay
 * far below 2^53 even after many moves.
 */
const FRESH_DEVICE_SEQ_GAP = 1_000_000;

/** A local answer; the next change of its question must exceed `base` too. */
type Answer = StoredAnswer & { base?: number };

/** What an {@link AnswerQueue} keeps in storage under its key. */
interface Saved {
  v: 1;
  /** The seq a question without a local answer numbers its changes above. */
  floor: number;
  answers: Answer[];
  pending: AnswerChange[];
}

const isSaved = (value: unknown): value is Saved => {
  const s = value as Saved | null;
  return (
    s?.v === 1 &&
    typeof s.floor === "number" &&
    Array.isArray(s.answers) &&
    Array.isArray(s.pending)
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
 * change with the highest seq. On a queue whose storage held nothing usable
 * (a fresh device, cleared storage, or unreadable state), call `restore`
 * before the first `set`: that first restore numbers later changes from the
 * server's seqs plus {@link FRESH_DEVICE_SEQ_GAP}. A queue that is `set`
 * without a restore starts at seq 1.
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
  private readonly answers: Map<string, Answer>;
  private changes: AnswerChange[];
  private floor: number;
  private fresh: boolean;
  private failed = false;

  /** Loads what `storage` holds under `key`, or starts empty. */
  constructor(storage: Storage, key: string, participantId: string) {
    this.storage = storage;
    this.key = key;
    this.participantId = participantId;
    const saved = readStored(storage, key, isSaved);
    this.answers = new Map(saved?.answers.map((a) => [a.questionId, a]));
    this.changes = saved?.pending ?? [];
    this.floor = saved?.floor ?? 0;
    this.fresh = saved === null;
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
  set(questionId: string, optionIds: string[]): AnswerChange {
    const last = this.answers.get(questionId);
    const seq = Math.max(last?.seq ?? 0, last?.base ?? this.floor) + 1;
    const change: AnswerChange = {
      changeId: newChangeId(),
      participantId: this.participantId,
      questionId,
      optionIds,
      seq,
    };
    this.answers.set(questionId, { questionId, optionIds, seq });
    this.changes = this.changes.filter((c) => c.questionId !== questionId);
    this.changes.push(change);
    this.fresh = false;
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

  /** Returns the option ids picked for a question, or undefined if unanswered. */
  current(questionId: string): string[] | undefined {
    return this.answers.get(questionId)?.optionIds;
  }

  /**
   * Merges the answers the server holds. A local answer with a higher seq
   * than the server's stays, and stays pending; otherwise the server's answer
   * and seq replace it and its unacked change is dropped. Questions the server
   * does not list keep their local answer. On a fresh queue (see the class
   * doc) it also sets the seq gap.
   */
  restore(server: StoredAnswer[]): void {
    if (this.fresh) this.floor = FRESH_DEVICE_SEQ_GAP;
    for (const s of server) {
      const local = this.answers.get(s.questionId);
      if ((local?.seq ?? 0) > s.seq) continue;
      const base = this.fresh ? s.seq + FRESH_DEVICE_SEQ_GAP : local?.base;
      this.answers.set(s.questionId, { ...s, base });
      this.changes = this.changes.filter((c) => c.questionId !== s.questionId);
    }
    this.fresh = false;
    this.save();
  }

  private save(): void {
    const saved: Saved = {
      v: 1,
      floor: this.floor,
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
