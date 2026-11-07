import type { TagScore } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";

/**
 * «За тегами»: one row per tag with the whole class's share of points on its
 * questions, as a bar in the journal's full, partial or zero colour and a
 * percent, «—» for a tag nobody could score on yet.
 */
export function TagScores({ tags }: { tags: TagScore[] }) {
  return (
    <section className="r-tags">
      <h2>
        {m.results_tags()} <span>{m.results_tags_hint()}</span>
      </h2>
      <ul>
        {tags.map((t) => (
          <li key={t.tag}>
            <span className="r-tags-name" title={t.tag}>
              # {t.tag}
            </span>
            <span className="r-tags-bar" aria-hidden="true">
              {t.pct != null && (
                <i
                  data-state={
                    t.pct >= 75 ? "full" : t.pct >= 50 ? "partial" : "zero"
                  }
                  style={{ width: `${t.pct}%` }}
                />
              )}
            </span>
            <b>{t.pct == null ? "—" : `${t.pct}%`}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
