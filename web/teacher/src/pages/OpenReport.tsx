import type { OpenNote, TestDoc } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Link, useNavigate } from "@tanstack/react-router";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/** The text of each note, by its code. */
const NOTES: Record<string, (n: OpenNote) => string> = {
  image_lost: () => m.note_image_lost(),
  area_reshaped: () => m.note_area_reshaped(),
  order_extra_dropped: (n) =>
    m.note_order_extra_dropped({ count: n.count ?? 0 }),
  hint_dropped: () => m.note_hint_dropped(),
  text_cut: () => m.note_text_cut(),
};

/**
 * The report on a test just opened from the older format: how many questions
 * came across, and for each note a link to the builder at its question.
 * «Відкрити тест» opens the builder at its first question; `onClose` is called
 * when the teacher closes the report, staying on the library.
 */
export function OpenReport({
  doc,
  onClose,
}: {
  doc: TestDoc;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const notes = doc.notes ?? [];
  const number = new Map(doc.test.questions.map((q, i) => [q.id, i + 1]));
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      title={m.tests_opened({ title: doc.test.title })}
      cancel={m.action_close()}
      confirm={m.open_report_open()}
      variant="primary"
      onConfirm={() => navigate({ to: "/tests/$id", params: { id: doc.id } })}
      details={
        <div className="t-notice t-report">
          <div>
            {notes.length > 0 && (
              <>
                <p>{m.open_report_attention()}</p>
                <ul>
                  {notes.map((n) => (
                    <li key={`${n.questionId} ${n.code}`}>
                      <Link
                        to="/tests/$id"
                        params={{ id: doc.id }}
                        search={{ q: n.questionId }}
                        className="t-report-link"
                      >
                        {m.open_report_question({
                          number: number.get(n.questionId ?? "") ?? 0,
                          note: NOTES[n.code](n),
                        })}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      }
    >
      {m.open_report_count({ count: doc.test.questions.length })}
    </ConfirmDialog>
  );
}
