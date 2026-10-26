import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, FileTrigger, Input, SearchField } from "react-aria-components";
import {
  busy,
  useCreateTest,
  useDeleteTest,
  useDeletingTests,
  useDuplicateTest,
  useExportTest,
  useImportTest,
  useTests,
} from "../api/queries";
import { cooldown } from "../cooldown";
import { finishExport } from "../ui/finishExport";
import { Icon } from "../ui/icons";
import { LoadError } from "../ui/LoadError";
import "./tests.css";

/**
 * The test library: newest first, each row opening the builder. The search
 * matches titles, ignoring case. «Відкрити» opens a .klats file as a new test,
 * which lands at the top while the page stays on the library.
 */
export function TestsPage() {
  const tests = useTests();
  const deleting = useDeletingTests();
  const create = useCreateTest();
  const remove = useDeleteTest();
  const duplicate = useDuplicateTest();
  const exportTest = useExportTest();
  const open = useImportTest();
  const [query, setQuery] = useState("");
  const [mayDelete] = useState(() => cooldown());
  const navigate = useNavigate();
  // The server lists the newest edit first.
  const all = (tests.data ?? []).filter((t) => !deleting.includes(t.id));
  const needle = query.trim().toLocaleLowerCase(getLocale());
  const rows = all.filter((t) =>
    t.title.toLocaleLowerCase(getLocale()).includes(needle),
  );
  const edited = new Intl.DateTimeFormat(getLocale(), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const openFile = (
    <FileTrigger
      acceptedFileTypes={[".klats"]}
      onSelect={(files) => {
        const file = files?.[0];
        if (file && !busy("importTest")) open.mutate(file);
      }}
    >
      <Button className="t-btn" data-variant="quiet" isPending={open.isPending}>
        <Icon name="folder" />
        {m.tests_open()}
      </Button>
    </FileTrigger>
  );
  const newTest = (
    <Button
      className="t-btn"
      data-variant="primary"
      isPending={create.isPending}
      onPress={() => {
        if (busy("createTest")) return;
        create.mutate(undefined, {
          onSuccess: (doc) =>
            navigate({ to: "/tests/$id", params: { id: doc.id } }),
        });
      }}
    >
      <Icon name="plus" />
      {m.tests_new()}
    </Button>
  );

  if (tests.isError) return <LoadError onRetry={() => tests.refetch()} />;
  if (!tests.data) return null;
  if (all.length === 0) {
    return (
      <div className="t-page">
        <div className="t-empty">
          <span className="t-mark t-mark-big" aria-hidden="true">
            <Icon name="plus" />
          </span>
          <h1>{m.tests_empty_title()}</h1>
          <p>{m.tests_empty_text()}</p>
          <div className="t-tests-tools">
            {openFile}
            {newTest}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="t-page">
      <header className="t-page-head">
        <div>
          <h1>{m.nav_tests()}</h1>
          <p>{m.tests_count({ count: all.length })}</p>
        </div>
        <div className="t-tests-tools">
          <SearchField
            className="t-field t-tests-search"
            aria-label={m.tests_search()}
            value={query}
            onChange={setQuery}
          >
            <Input placeholder={m.tests_search()} />
          </SearchField>
          {openFile}
          {newTest}
        </div>
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
              className="t-btn t-test-act"
              data-variant="quiet"
              onPress={() => !busy("duplicateTest") && duplicate.mutate(t)}
            >
              <Icon name="copy" />
              {m.tests_duplicate()}
            </Button>
            <Button
              className="t-btn t-test-act"
              data-variant="quiet"
              onPress={() =>
                !busy("exportTest") &&
                exportTest.mutate(t.id, { onSuccess: finishExport })
              }
            >
              <Icon name="download" />
              {m.tests_export()}
            </Button>
            <Button
              className="t-icon-btn"
              data-variant="danger"
              aria-label={m.tests_delete({ title: t.title })}
              onPress={() => mayDelete() && remove.mutate(t)}
            >
              <Icon name="trash" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
