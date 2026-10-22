import type {
  AnswerChange,
  StoredAnswer,
} from "@klats/shared/generated/wire.ts";

/** What an {@link AnswerQueue} keeps in storage under its key. */
interface Saved {
  answers: StoredAnswer[];
  pending: AnswerChange[];
}

/**
 * A participant's answers on this device and the changes the server has not
 * acknowledged yet, saved to storage after every write so a reload or crash
 * loses nothing. One queue holds one participant: the caller keys the storage
 * by participant id, and every change carries that id.
 *
 * Each question numbers its changes with a `seq` that only goes up, across
 * reloads and {@link AnswerQueue.restore}, because the server keeps the
 * change with the highest seq.
 *
 * Only the newest unacked change of a question is pending: a newer one
 * replaces it, since the server would ignore the older one anyway.
 */
export class AnswerQueue {
  private readonly storage: Storage;
  private readonly key: string;
  private readonly participantId: string;
  private readonly answers: Map<string, StoredAnswer>;
  private changes: AnswerChange[];

  /** Loads what `storage` holds under `key`, or starts empty. */
  constructor(storage: Storage, key: string, participantId: string) {
    this.storage = storage;
    this.key = key;
    this.participantId = participantId;
    const saved: Saved | null = JSON.parse(storage.getItem(key) ?? "null");
    this.answers = new Map(saved?.answers.map((a) => [a.questionId, a]));
    this.changes = saved?.pending ?? [];
  }

  /**
   * Records the answer to a question and returns the change to send, which
   * replaces any unacked change of that question.
   */
  set(questionId: string, optionIds: string[]): AnswerChange {
    const seq = (this.answers.get(questionId)?.seq ?? 0) + 1;
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
   * does not list keep their local answer.
   */
  restore(server: StoredAnswer[]): void {
    for (const s of server) {
      if ((this.answers.get(s.questionId)?.seq ?? 0) > s.seq) continue;
      this.answers.set(s.questionId, s);
      this.changes = this.changes.filter((c) => c.questionId !== s.questionId);
    }
    this.save();
  }

  private save(): void {
    const saved: Saved = {
      answers: [...this.answers.values()],
      pending: this.changes,
    };
    this.storage.setItem(this.key, JSON.stringify(saved));
  }
}

/** Returns 16 random bytes as lowercase hex. */
function newChangeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
