import type { TestDoc } from "@klats/shared/generated/wire.ts";
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
import { OpenReport } from "./OpenReport";
import "./tests.css";

/**
 * `s` as the search compares it: in lower case, with ' and ʼ read as ’, so a
 * title typed with any of the three apostrophes is found.
 */
const searchable = (s: string) =>
  s.toLocaleLowerCase(getLocale()).replace(/['ʼ]/g, "’");

/**
 * The test library: newest first, each row opening the builder. The search
 * matches titles, ignoring case and the kind of apostrophe. «Відкрити» opens a
 * .klats or .mtf file as a new test, which lands at the top while the page
 * stays on the library; the notes of an .mtf file's conversion are shown in
 * {@link OpenReport}.
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
  const [report, setReport] = useState<TestDoc | null>(null);
  const [mayDelete] = useState(() => cooldown());
  const navigate = useNavigate();
  // The server lists the newest edit first.
  const all = (tests.data ?? []).filter((t) => !deleting.includes(t.id));
  const needle = searchable(query.trim());
  const rows = all.filter((t) => searchable(t.title).includes(needle));
  const edited = new Intl.DateTimeFormat(getLocale(), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const openFile = (
    <FileTrigger
      acceptedFileTypes={[".klats", ".mtf"]}
      onSelect={(files) => {
        const file = files?.[0];
        if (!file || busy("importTest")) return;
        open.mutate(file, {
          onSuccess: (doc) => doc.notes?.length && setReport(doc),
        });
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
  const openReport = report && (
    <OpenReport doc={report} onClose={() => setReport(null)} />
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
        {openReport}
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
      {rows.length === 0 && (
        <p className="t-tests-none">{m.tests_none_found()}</p>
      )}
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
                id={`t-title-${t.id}`}
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
              aria-describedby={`t-title-${t.id}`}
              onPress={() => !busy("duplicateTest") && duplicate.mutate(t)}
            >
              <Icon name="copy" />
              {m.tests_duplicate()}
            </Button>
            <Button
              className="t-btn t-test-act"
              data-variant="quiet"
              aria-describedby={`t-title-${t.id}`}
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
      {openReport}
    </div>
  );
}
