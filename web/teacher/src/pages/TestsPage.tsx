import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "react-aria-components";
import {
  useCreateTest,
  useDeleteTest,
  useDeletingTests,
  useTests,
} from "../api/queries";
import { Icon } from "../ui/icons";
import { LoadError } from "../ui/LoadError";
import "./tests.css";

/** The test library: newest first, each row opening the builder. */
export function TestsPage() {
  const tests = useTests();
  const deleting = useDeletingTests();
  const create = useCreateTest();
  const remove = useDeleteTest();
  const navigate = useNavigate();
  // The server lists the newest edit first.
  const rows = (tests.data ?? []).filter((t) => !deleting.includes(t.id));
  const edited = new Intl.DateTimeFormat(getLocale(), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const newTest = (
    <Button
      className="t-btn"
      data-variant="primary"
      isPending={create.isPending}
      onPress={() =>
        create.mutate(undefined, {
          onSuccess: (doc) =>
            navigate({ to: "/tests/$id", params: { id: doc.id } }),
        })
      }
    >
      <Icon name="plus" />
      {m.tests_new()}
    </Button>
  );

  if (tests.isError) return <LoadError onRetry={() => tests.refetch()} />;
  if (!tests.data) return null;
  if (rows.length === 0) {
    return (
      <div className="t-page">
        <div className="t-empty">
          <span className="t-mark t-mark-big" aria-hidden="true">
            <Icon name="plus" />
          </span>
          <h1>{m.tests_empty_title()}</h1>
          <p>{m.tests_empty_text()}</p>
          {newTest}
        </div>
      </div>
    );
  }
  return (
    <div className="t-page">
      <header className="t-page-head">
        <div>
          <h1>{m.nav_tests()}</h1>
          <p>{m.tests_count({ count: rows.length })}</p>
        </div>
        {newTest}
      </header>
      <ul className="t-tests">
        {rows.map((t) => (
          <li key={t.id} className="t-test">
            <span className="t-test-count">
              <b>{t.questionCount}</b>
              {m.tests_questions({ count: t.questionCount })}
            </span>
            <span className="t-test-main">
              <Link
                to="/tests/$id"
                params={{ id: t.id }}
                className="t-test-title"
              >
                {t.title}
              </Link>
              <span className="t-test-meta">
                {m.tests_edited({ date: edited.format(t.updatedAt) })}
              </span>
            </span>
            <Button
              className="t-icon-btn"
              data-variant="danger"
              aria-label={m.tests_delete({ title: t.title })}
              onPress={() => remove.mutate(t)}
            >
              <Icon name="trash" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
