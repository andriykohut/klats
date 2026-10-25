import type { Image } from "@klats/shared/generated/testfmt.ts";
import type {
  ResultQuestion,
  ResultRow,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  MediaImage,
  type RichDoc,
  RichView,
} from "@klats/shared/rich/RichView.tsx";
import type { ReactNode } from "react";
import { Icon } from "../../ui/icons";
import { type ReviewRow, reviewRows } from "./review";

/**
 * One student's answer to one question, in the form its type needs: the
 * options for single and multiple choice, the rows of every type that lists
 * parts, the two orders for ordering, the picture with the areas and the
 * student's point for a hotspot, the numbered points and rows for labels, the
 * words for highlighting, and the written text with its marking notes for a
 * written answer. Every right-or-wrong mark is the server's verdict.
 */
export function AnswerReview(props: {
  result: ResultQuestion;
  row: ResultRow;
}) {
  const { result, row } = props;
  const q = result.question;
  const answer = row.answers[q.id];
  const verdicts = row.verdicts[q.id];
  switch (q.type) {
    case "single":
    case "multi":
      return (
        <ul className="r-opts">
          {q.options.map((o) => {
            const chosen = (answer?.items ?? []).includes(o.id);
            return (
              <li
                key={o.id}
                className="r-opt"
                data-chosen={chosen || undefined}
                data-correct={o.correct || undefined}
              >
                <span className="r-mark" data-type={q.type} aria-hidden="true">
                  {chosen && <Icon name="check" />}
                </span>
                <span className="r-opt-text">
                  <RichView doc={o.content as RichDoc} />
                </span>
                {chosen && <small className="r-tag">{m.detail_picked()}</small>}
                {o.correct && (
                  <small className="r-tag" data-tone="ok">
                    {m.detail_correct()}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      );
    case "order": {
      const given = answer?.items ?? [];
      if (given.length === 0) return null;
      const text = (id: string) => (
        <Rich value={q.options.find((o) => o.id === id)?.content ?? ""} />
      );
      return (
        <div className="r-orders">
          <section>
            <h4>{m.review_order_student()}</h4>
            <ol>
              {given.map((id) => (
                <li key={id} data-moved={verdicts?.[id] === false || undefined}>
                  {text(id)}
                  {verdicts?.[id] === false && (
                    <small className="r-moved">{m.review_moved()}</small>
                  )}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h4>{m.review_order_key()}</h4>
            <ol>
              {q.options.map((o) => (
                <li key={o.id}>{text(o.id)}</li>
              ))}
            </ol>
          </section>
        </div>
      );
    }
    case "hotspot":
      return q.image ? (
        <Picture image={q.image}>
          {(q.areas ?? []).map((a) => (
            <i
              key={a.id}
              className="r-area"
              data-shape={a.shape}
              style={{
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                width: `${a.w * 100}%`,
                height: `${a.h * 100}%`,
              }}
            />
          ))}
          {answer?.point && (
            <span
              className="r-dot"
              data-ok={String(verdicts?.[""] === true)}
              role="img"
              aria-label={m.review_click()}
              style={{
                left: `${answer.point.x * 100}%`,
                top: `${answer.point.y * 100}%`,
              }}
            />
          )}
        </Picture>
      ) : null;
    case "label": {
      const rows = reviewRows(q, answer, verdicts);
      return (
        <>
          {q.image && (
            <Picture image={q.image}>
              {(q.targets ?? []).map((t, i) => (
                <span
                  key={t.id}
                  className="r-pin"
                  data-ok={rows[i]?.ok ?? undefined}
                  style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                >
                  {i + 1}
                </span>
              ))}
            </Picture>
          )}
          <Rows rows={rows} />
        </>
      );
    }
    case "highlight": {
      const chosen = new Set(answer?.items ?? []);
      const marked = new Set(result.targetWords ?? []);
      return (
        <>
          <div className="r-words">
            <RichView
              doc={result.words as RichDoc}
              word={(i, children) => {
                const key = String(i);
                const state = chosen.has(key)
                  ? verdicts?.[key]
                    ? "hit"
                    : "extra"
                  : marked.has(key)
                    ? "missed"
                    : undefined;
                return (
                  <span className="r-word" data-state={state}>
                    {children}
                    {state && (
                      <span className="r-sr">{WORD_TEXT[state]()}</span>
                    )}
                  </span>
                );
              }}
            />
          </div>
          <ul className="r-key">
            {(["hit", "extra", "missed"] as const).map((state) => (
              <li key={state}>
                <span
                  className="r-word"
                  data-state={state}
                  aria-hidden="true"
                />
                {WORD_TEXT[state]()}
              </li>
            ))}
          </ul>
        </>
      );
    }
    case "open":
      return (
        <>
          {answer?.text?.trim() && (
            <div className="r-written">
              <h4>{m.review_open_answer()}</h4>
              <p>{answer.text}</p>
            </div>
          )}
          {q.rubric && (
            <div className="r-rubric">
              <h4>{m.review_rubric()}</h4>
              <p>{q.rubric}</p>
            </div>
          )}
        </>
      );
    default:
      return <Rows rows={reviewRows(q, answer, verdicts)} />;
  }
}

const WORD_TEXT = {
  hit: m.review_word_hit,
  extra: m.review_word_extra,
  missed: m.review_word_missed,
};

/** Text or a rich document, on the line of its row. */
function Rich({ value }: { value: RichDoc | string }) {
  return typeof value === "string" ? value : <RichView doc={value} />;
}

/** The rows of a review: «Учень: … ✗ · Правильно: …», the right answer left out once it was given. */
function Rows({ rows }: { rows: ReviewRow[] }) {
  return (
    <ul className="r-rows">
      {rows.map((r, i) => (
        <li key={i} className="r-row">
          <span className="r-row-prompt">
            <Rich value={r.prompt} />
          </span>
          <span className="r-row-line">
            <small>{m.review_student()}:</small>{" "}
            {r.given === null ? "—" : <Rich value={r.given} />}
            {r.ok !== null && (
              <span
                className="r-verdict"
                data-ok={r.ok}
                role="img"
                aria-label={r.ok ? m.review_right() : m.review_wrong()}
              >
                <Icon name={r.ok ? "check" : "close"} />
              </span>
            )}
            {r.ok !== true && (
              <>
                <span aria-hidden="true"> · </span>
                <small>{m.review_right()}:</small> <Rich value={r.expected} />
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A question's picture at its own shape, with `children` laid over it as fractions of its size. */
function Picture(props: { image: Image; children: ReactNode }) {
  const { image } = props;
  return (
    <div
      className="r-pic"
      style={{
        aspectRatio: `${image.w} / ${image.h}`,
        width: `min(100%, ${image.w}px, ${(40 * image.w) / image.h}vh)`,
      }}
    >
      <MediaImage
        className="r-pic-img"
        src={image.src}
        w={image.w}
        h={image.h}
      />
      {props.children}
    </div>
  );
}
