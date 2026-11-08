import { averageText, gradeBand } from "@klats/shared/grades.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "react-aria-components";
import {
  useAssignments,
  useDeleteAssignment,
  useDeletingAssignments,
  useRunningAssignment,
} from "../../api/queries";
import { cooldown } from "../../cooldown";
import { Icon } from "../../ui/icons";
import { LoadError } from "../../ui/LoadError";
import { formatDate } from "../live/journal";
import "../live/journal.css";
import "./results.css";

/** «Результати»: every assignment, newest first, each opening its results. */
export function AssignmentsPage() {
  const list = useAssignments();
  const deleting = useDeletingAssignments();
  const remove = useDeleteAssignment();
  const running = useRunningAssignment();
  const [mayDelete] = useState(() => cooldown());
  if (list.isError) return <LoadError onRetry={() => list.refetch()} />;
  if (!list.data) return null;
  const rows = list.data.filter((a) => !deleting.includes(a.id));
  const locale = getLocale();
  const when = (at: number) =>
    formatDate(at, locale, {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (rows.length === 0) {
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
        {rows.map((a) => (
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
                <b
                  data-band={
                    a.scale === "pass"
                      ? gradeBand("percent", a.averageGrade * 100)
                      : gradeBand(a.scale, Math.round(a.averageGrade))
                  }
                >
                  {averageText(a.scale, a.averageGrade, locale)}
                </b>
              )}
            </span>
            <Button
              className="t-icon-btn"
              data-variant="danger"
              aria-label={m.results_delete({ title: a.testTitle })}
              isDisabled={a.id === running}
              onPress={() =>
                mayDelete() && remove.mutate({ id: a.id, title: a.testTitle })
              }
            >
              <Icon name="trash" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
