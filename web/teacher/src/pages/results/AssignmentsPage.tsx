import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link } from "@tanstack/react-router";
import { useAssignments } from "../../api/queries";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { band, formatDate, formatPoints } from "../live/journal";
import "../live/journal.css";
import "./results.css";

/** «Результати»: every assignment, newest first, each opening its results. */
export function AssignmentsPage() {
  const list = useAssignments();
  if (list.isError) return <LoadError onRetry={() => list.refetch()} />;
  if (!list.data) return null;
  const locale = getLocale();
  const when = (at: number) =>
    formatDate(at, locale, {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (list.data.length === 0) {
    return (
      <div className="t-page">
        <div className="t-empty">
          <span className="t-mark t-mark-big" aria-hidden="true">
            <Icon name="check" />
          </span>
          <h1>{m.results_empty_title()}</h1>
          <p>{m.results_empty_text()}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="t-page">
      <header className="t-page-head">
        <h1>{m.nav_results()}</h1>
      </header>
      <ul className="r-list">
        {list.data.map((a) => (
          <li key={a.id} className="r-item">
            <span className="r-item-main">
              <Link
                to="/assignments/$id"
                params={{ id: a.id }}
                className="r-item-title"
              >
                {a.testTitle}
              </Link>
              <span className="r-item-meta">
                {[
                  a.className || m.results_no_class(),
                  when(a.createdAt),
                  m.classes_students({ count: a.participants }),
                ].join(" · ")}
              </span>
            </span>
            <span className="r-avg">
              <small>{m.results_average()}</small>
              {a.averageGrade == null ? (
                <b>—</b>
              ) : (
                <b data-band={band(Math.round(a.averageGrade))}>
                  {formatPoints(Math.round(a.averageGrade * 10) / 10, locale)}
                </b>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
