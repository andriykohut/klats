import type { Class } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  ListBox,
  ListBoxItem,
  TextField,
} from "react-aria-components";
import {
  useClass,
  useClasses,
  useCreateClass,
  useDeleteClass,
  useSaveClass,
} from "../api/queries";
import { classError, MAX_NAME } from "../forms";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/icons";
import { LoadError } from "../ui/LoadError";
import { notify } from "../ui/Toasts";
import "./classes.css";
import { PasteDialog } from "./PasteDialog";

/**
 * The class lists: the classes on the left, the open class on the right.
 * Without a choice, the first class is open. «Новий клас» creates an empty
 * class at once and opens it with the cursor in its name.
 */
export function ClassesPage() {
  const classes = useClasses();
  const create = useCreateClass();
  const [chosen, setChosen] = useState<string | null>(null);
  const [created, setCreated] = useState("");
  const collator = new Intl.Collator(getLocale(), { numeric: true });
  const list = [...(classes.data ?? [])].sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  const open = list.find((c) => c.id === chosen) ?? list[0];

  if (classes.isError) return <LoadError onRetry={() => classes.refetch()} />;
  if (!classes.data) return null;

  const newClass = (
    <Button
      className="t-btn"
      data-variant="primary"
      isPending={create.isPending}
      onPress={() =>
        create.mutate(
          { name: m.classes_new(), students: [] },
          {
            onSuccess: (c) => {
              setChosen(c.id);
              setCreated(c.id);
            },
          },
        )
      }
    >
      <Icon name="plus" />
      {m.classes_new()}
    </Button>
  );

  if (!open) {
    return (
      <div className="t-page">
        <div className="t-empty">
          <span className="t-mark t-mark-big" aria-hidden="true">
            <Icon name="plus" />
          </span>
          <h1>{m.classes_empty_title()}</h1>
          <p>{m.classes_empty_text()}</p>
          {newClass}
        </div>
      </div>
    );
  }
  return (
    <div className="t-page t-page-fill">
      <header className="t-page-head">
        <h1>{m.nav_classes()}</h1>
        {newClass}
      </header>
      <div className="t-classes">
        <ListBox
          className="t-panel t-class-list"
          aria-label={m.nav_classes()}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[open.id]}
          onSelectionChange={(keys) => {
            const [id] = keys as Set<string>;
            if (id) setChosen(id);
          }}
        >
          {list.map((c) => (
            <ListBoxItem
              key={c.id}
              id={c.id}
              textValue={c.name}
              className="t-class-item"
            >
              <b>{c.name}</b>
              <span>{m.classes_students({ count: c.studentCount })}</span>
            </ListBoxItem>
          ))}
        </ListBox>
        <section className="t-panel t-class-detail">
          <ClassView
            key={open.id}
            id={open.id}
            fresh={open.id === created}
            onDeleted={() => setChosen(null)}
          />
        </section>
      </div>
    </div>
  );
}

function ClassView(props: {
  id: string;
  fresh: boolean;
  onDeleted: () => void;
}) {
  const cls = useClass(props.id);
  if (cls.isError) return <LoadError onRetry={() => cls.refetch()} />;
  if (!cls.data) return null;
  return (
    <ClassEditor
      cls={cls.data}
      fresh={props.fresh}
      onDeleted={props.onDeleted}
    />
  );
}

/** A student row being edited; `key` stays put while the name changes. */
interface Row {
  key: string;
  id: string;
  name: string;
}

/** The class's students as rows, or one empty row to type into for a class without any. */
function rows(c: Class): Row[] {
  if (c.students.length === 0) return [{ key: "first", id: "", name: "" }];
  return c.students.map((s) => ({ key: s.id, id: s.id, name: s.name }));
}

/**
 * One class, editable: its name, and its students typed in (Enter goes to
 * the next row, and on the last one adds a row), renamed and removed, or
 * pasted through «Вставити список». Empty rows are ignored. «Зберегти» sends
 * it all; the reply lists the students in Ukrainian order. Opening another
 * class or page saves edits left unsaved, unless they are invalid.
 */
function ClassEditor(props: {
  cls: Class;
  fresh: boolean;
  onDeleted: () => void;
}) {
  const { cls } = props;
  const [name, setName] = useState(cls.name);
  const [students, setStudents] = useState(() => rows(cls));
  const [added, setAdded] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const nextRow = useRef(0);
  // A new class opens with its placeholder name selected, so typing replaces it.
  const selectName = useRef(props.fresh);
  const save = useSaveClass();
  const remove = useDeleteClass();

  const named = students.filter((s) => s.name.trim() !== "");
  const dirty =
    name !== cls.name ||
    named.length !== cls.students.length ||
    named.some(
      (s, i) => s.id !== cls.students[i].id || s.name !== cls.students[i].name,
    );
  const draft: Class = {
    id: cls.id,
    name: name.trim(),
    students: named.map(({ id, name }) => ({ id, name })),
  };
  const invalid = classError({
    name,
    students: named.map((s) => s.name),
  });

  // What leaving should save: the draft while it has valid unsaved edits.
  // shortcut: closing the window still drops unsaved edits; save them on
  // pagehide too if teachers lose names that way.
  const unsaved = useRef<Class | null>(null);
  const gone = useRef(false);
  useEffect(() => {
    unsaved.current = dirty && !invalid ? draft : null;
  });
  const saveOnLeave = save.mutateAsync;
  useEffect(
    () => () => {
      const c = unsaved.current;
      if (!c || gone.current) return;
      saveOnLeave(c).then(
        () => notify(m.classes_saved_named({ name: c.name })),
        () => {}, // the mutation cache reports the failure
      );
    },
    [saveOnLeave],
  );

  const reset = (c: Class) => {
    setName(c.name);
    setStudents(rows(c));
    setError("");
  };
  const newRow = (name: string): Row => ({
    key: `new-${nextRow.current++}`,
    id: "",
    name,
  });
  const add = () => {
    const row = newRow("");
    setStudents((list) => [...list, row]);
    setAdded(row.key);
  };
  const focusRow = (from: HTMLElement, i: number) => {
    const next = from.closest("ol")?.querySelectorAll("input")[i];
    if (next) next.focus();
    else add();
  };
  const onRowKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i < students.length - 1) focusRow(e.currentTarget, i + 1);
    else if (students[i].name.trim() !== "") add();
  };
  const submit = () => {
    if (invalid) {
      setError(
        invalid.field === "name"
          ? m.classes_name_required()
          : m.classes_name_too_long({ name: named[invalid.index].name }),
      );
      return;
    }
    save.mutate(draft, {
      onSuccess: (c) => {
        reset(c);
        notify(m.classes_saved());
      },
    });
  };

  return (
    <div className="t-class-editor">
      <header className="t-class-head">
        <TextField
          className="t-class-name"
          aria-label={m.classes_name()}
          value={name}
          onChange={setName}
          maxLength={MAX_NAME}
          autoFocus={props.fresh}
          onFocus={(e) => {
            if (!selectName.current) return;
            selectName.current = false;
            (e.target as HTMLInputElement).select();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const list = (e.target as HTMLElement)
              .closest(".t-class-editor")
              ?.querySelector("ol");
            if (list) focusRow(list, 0);
          }}
        >
          <Input />
        </TextField>
        <span className="t-class-count">
          {m.classes_students({ count: named.length })}
        </span>
        <Button
          className="t-btn"
          data-variant="quiet-danger"
          onPress={() => setConfirming(true)}
        >
          <Icon name="trash" />
          {m.classes_delete()}
        </Button>
      </header>
      <div className="t-students-scroll">
        <ol className="t-students">
          {students.map((s, i) => (
            <li key={s.key}>
              <span className="t-num" aria-hidden="true">
                {i + 1}
              </span>
              <Input
                aria-label={m.classes_student({ number: i + 1 })}
                placeholder={m.classes_student_placeholder()}
                value={s.name}
                maxLength={MAX_NAME}
                autoFocus={s.key === added}
                onChange={(e) =>
                  setStudents((list) =>
                    list.map((x) =>
                      x.key === s.key ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
                onKeyDown={(e) => onRowKey(e, i)}
              />
              <Button
                className="t-icon-btn"
                data-variant="danger"
                aria-label={m.classes_remove({
                  name: s.name || String(i + 1),
                })}
                onPress={() =>
                  setStudents((list) => list.filter((x) => x.key !== s.key))
                }
              >
                <Icon name="close" />
              </Button>
            </li>
          ))}
        </ol>
      </div>
      <div className="t-class-add">
        <Button className="t-btn" data-variant="dashed" onPress={add}>
          <Icon name="plus" />
          {m.classes_add_student()}
        </Button>
        <PasteDialog
          onAdd={(names) => {
            const pasted = names.map(newRow);
            setStudents((list) => [
              ...list.filter((s) => s.name.trim() !== ""),
              ...pasted,
            ]);
          }}
        />
      </div>
      <footer className="t-class-foot" data-dirty={dirty || undefined}>
        <p
          className="t-class-state"
          data-error={error ? true : undefined}
          aria-live="polite"
        >
          {error || (dirty ? m.classes_unsaved() : m.classes_sorted())}
        </p>
        <Button
          className="t-btn"
          data-variant="quiet"
          isDisabled={!dirty}
          onPress={() => reset(cls)}
        >
          {m.classes_revert()}
        </Button>
        <Button
          className="t-btn"
          data-variant="primary"
          isDisabled={!dirty}
          isPending={save.isPending}
          onPress={submit}
        >
          {m.action_save()}
        </Button>
      </footer>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={m.classes_delete_title({ name: cls.name })}
        confirm={m.classes_delete()}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(cls.id, {
            onSuccess: () => {
              gone.current = true;
              setConfirming(false);
              notify(m.classes_deleted({ name: cls.name }));
              props.onDeleted();
            },
          })
        }
      >
        {m.classes_delete_text({ count: cls.students.length })}
      </ConfirmDialog>
    </div>
  );
}
