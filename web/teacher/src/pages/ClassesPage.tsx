import type { Class } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  ListBox,
  ListBoxItem,
  TextField,
} from "react-aria-components";
import {
  busy,
  useClass,
  useClasses,
  useCreateClass,
  useDeleteClass,
  useSaveClass,
} from "../api/queries";
import { cooldown } from "../cooldown";
import { classError, MAX_NAME } from "../forms";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/icons";
import { LoadError } from "../ui/LoadError";
import { notify, toasts } from "../ui/Toasts";
import "./classes.css";
import { PasteDialog } from "./PasteDialog";

/** The id in /classes/{-$id} that opens a new, unsaved class. */
const NEW = "new";
const EMPTY: Class = { id: "", name: "", students: [] };

/**
 * The class lists at /classes/{-$id}: the classes on the left, the open class
 * on the right; without an id, the first class. «Новий клас» opens
 * /classes/new, a draft that the first «Зберегти» creates.
 */
export function ClassesPage() {
  const { id } = useParams({ strict: false });
  const navigate = useNavigate();
  const classes = useClasses();
  const collator = new Intl.Collator(getLocale(), { numeric: true });
  const list = [...(classes.data ?? [])].sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  const draft = id === NEW;
  const open = draft ? null : (list.find((c) => c.id === id) ?? list[0]);
  const go = (to?: string) =>
    navigate({ to: "/classes/{-$id}", params: { id: to } });

  if (classes.isError) return <LoadError onRetry={() => classes.refetch()} />;
  if (!classes.data) return null;

  const newClass = (
    <Button className="t-btn" data-variant="primary" onPress={() => go(NEW)}>
      <Icon name="plus" />
      {m.classes_new()}
    </Button>
  );

  if (!draft && !open) {
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
          selectedKeys={[open?.id ?? NEW]}
          onSelectionChange={(keys) => {
            const [key] = keys as Set<string>;
            if (key) go(key);
          }}
        >
          {draft && (
            <ListBoxItem id={NEW} className="t-class-item t-class-draft">
              <b>{m.classes_new()}</b>
              <span>{m.classes_draft()}</span>
            </ListBoxItem>
          )}
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
          {open ? (
            <ClassView key={open.id} id={open.id} />
          ) : (
            <ClassEditor key={NEW} cls={EMPTY} />
          )}
        </section>
      </div>
    </div>
  );
}

function ClassView({ id }: { id: string }) {
  const cls = useClass(id);
  if (cls.isError) return <LoadError onRetry={() => cls.refetch()} />;
  if (!cls.data) return null;
  return <ClassEditor cls={cls.data} />;
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
 * Edits the server would refuse, and new classes never saved, kept by class
 * id (or "new") when the teacher leaves, until the editor opens again.
 */
// shortcut: kept edits live in memory, so closing the window drops them, as
// it drops any unsaved edit; save them on pagehide too if teachers lose names
// that way.
const kept = new Map<string, { name: string; students: Row[] }>();

/**
 * One class, editable, or with an empty `cls` a new one: its name, and its
 * students typed in (Enter goes to the next row, and on the last one adds a
 * row), renamed and removed, or pasted through «Вставити список». Empty rows
 * are ignored. «Зберегти» creates or saves it all; the reply lists the
 * students in Ukrainian order. On leaving, valid edits to a saved class are
 * saved; a new class or edits the server would refuse are kept, and a toast
 * leads back to them.
 */
function ClassEditor({ cls }: { cls: Class }) {
  const isNew = cls.id === "";
  const key = cls.id || NEW;
  const navigate = useNavigate();
  const [restored] = useState(() => kept.get(key));
  const [name, setName] = useState(restored?.name ?? cls.name);
  const [students, setStudents] = useState(
    () => restored?.students ?? rows(cls),
  );
  const [added, setAdded] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [mayRemove] = useState(() => cooldown());
  const nextRow = useRef(0);
  const undos = useRef<string[]>([]);
  const create = useCreateClass();
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

  // What leaving does with the edits, set after each render; `done` once
  // they reached the server or the class was deleted.
  const leave = useRef<(() => void) | null>(null);
  const done = useRef(false);
  useEffect(() => {
    kept.delete(key);
  }, [key]);
  useEffect(() => {
    leave.current = !dirty
      ? null
      : !isNew && !invalid
        ? () =>
            save.mutateAsync(draft).then(
              () => notify(m.classes_saved_named({ name: draft.name })),
              () => {}, // the mutation cache reports the failure
            )
        : () => {
            kept.set(key, { name, students });
            const toast = toasts.add(
              {
                text: m.classes_not_saved({
                  name: name.trim() || cls.name || m.classes_new(),
                }),
                action: {
                  label: m.classes_back(),
                  onAction: () => {
                    toasts.close(toast);
                    navigate({ to: "/classes/{-$id}", params: { id: key } });
                  },
                },
              },
              { timeout: 8000 },
            );
          };
  });
  useEffect(
    () => () => {
      for (const t of undos.current) toasts.close(t);
      if (!done.current) leave.current?.();
    },
    [],
  );

  // After a save or a revert the removed rows are gone for good, so their
  // undo toasts close: an undo would bring back a student the server deleted.
  const reset = (c: Class) => {
    setName(c.name);
    setStudents(rows(c));
    setError("");
    for (const t of undos.current) toasts.close(t);
    undos.current = [];
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
  const removeRow = (row: Row) => {
    if (!mayRemove()) return;
    const at = students.findIndex((s) => s.key === row.key);
    setStudents((list) => list.filter((s) => s.key !== row.key));
    if (row.name.trim() === "") return;
    const toast = toasts.add(
      {
        text: m.classes_student_removed({ name: row.name }),
        action: {
          label: m.action_undo(),
          onAction: () => {
            toasts.close(toast);
            setStudents((list) => [
              ...list.slice(0, at),
              row,
              ...list.slice(at),
            ]);
          },
        },
      },
      { timeout: 6000 },
    );
    undos.current.push(toast);
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
    if (busy("saveClass")) return;
    if (invalid) {
      setError(
        invalid.field === "name"
          ? m.classes_name_required()
          : m.classes_name_too_long({ name: named[invalid.index].name }),
      );
      return;
    }
    if (isNew) {
      create.mutate(draft, {
        onSuccess: (c) => {
          done.current = true;
          notify(m.classes_saved());
          navigate({
            to: "/classes/{-$id}",
            params: { id: c.id },
            replace: true,
          });
        },
      });
      return;
    }
    save.mutate(draft, {
      onSuccess: (c) => {
        reset(c);
        notify(m.classes_saved());
      },
    });
  };
  // The list refetch can unmount this editor before the delete settles, so
  // the follow-up hangs on the promise rather than on mutate callbacks.
  const deleteClass = () => {
    if (busy("deleteClass")) return;
    done.current = true;
    remove.mutateAsync(cls.id).then(
      () => {
        setConfirming(false);
        notify(m.classes_deleted({ name: cls.name }));
        navigate({ to: "/classes/{-$id}", params: { id: undefined } });
      },
      () => {
        done.current = false; // the mutation cache reports the failure
      },
    );
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
          autoFocus={isNew}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const list = (e.target as HTMLElement)
              .closest(".t-class-editor")
              ?.querySelector("ol");
            if (list) focusRow(list, 0);
          }}
        >
          <Input placeholder={m.typed_class_example()} />
        </TextField>
        <span className="t-class-count">
          {m.classes_students({ count: named.length })}
        </span>
        {!isNew && (
          <Button
            className="t-btn"
            data-variant="quiet-danger"
            onPress={() => setConfirming(true)}
          >
            <Icon name="trash" />
            {m.classes_delete()}
          </Button>
        )}
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
                onPress={() => removeRow(s)}
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
          {error ||
            (isNew
              ? m.classes_draft()
              : dirty
                ? m.classes_unsaved()
                : m.classes_sorted())}
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
          isPending={create.isPending || save.isPending}
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
        onConfirm={deleteClass}
      >
        {m.classes_delete_text({ count: cls.students.length })}
      </ConfirmDialog>
    </div>
  );
}
