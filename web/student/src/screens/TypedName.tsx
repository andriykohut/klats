import type { JoinInfo, Participant } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useId, useState } from "react";
import { pick } from "../api";
import { errorText, Problem, Prompt, startNote } from "./ui";

/** The server's limit on each typed part, in characters. */
const MAX = 60;

type Field = "surname" | "firstName" | "className";

/**
 * Surname, first name and class, for a sitting without a class list. Surname
 * and first name are required; the class is optional, as on the server. `info`
 * is the join's, for the {@link startNote} above the start button.
 */
export function TypedName({
  code,
  info,
  onPicked,
  onBack,
}: {
  code: string;
  info: JoinInfo;
  onPicked: (p: Participant) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState({
    surname: "",
    firstName: "",
    className: "",
  });
  const [missing, setMissing] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const note = startNote(info);

  const submit = async () => {
    const empty = (["surname", "firstName"] as const).filter(
      (f) => name[f].trim() === "",
    );
    setMissing(empty);
    if (empty.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      onPicked(await pick(code, name));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const field = (f: Field, label: string, placeholder?: string) => (
    <label className="s-label">
      {label}
      <input
        className="s-field"
        // biome-ignore lint/a11y/noAutofocus: the name is all this screen asks for
        autoFocus={f === "surname"}
        name={f}
        maxLength={MAX}
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={missing.includes(f) || undefined}
        aria-describedby={missing.includes(f) ? `${f}-missing` : undefined}
        value={name[f]}
        onChange={(e) => {
          setName({ ...name, [f]: e.target.value });
          setMissing(missing.filter((x) => x !== f));
        }}
      />
      {missing.includes(f) && (
        <span className="s-missing" id={`${f}-missing`}>
          <i className="k-dot" />
          {m.typed_required()}
        </span>
      )}
    </label>
  );

  return (
    <Prompt title={m.typed_title()}>
      <form
        className="s-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {field("surname", m.typed_surname())}
        {field("firstName", m.typed_first_name())}
        {field("className", m.typed_class(), m.typed_class_example())}
        {error && <Problem>{error}</Problem>}
        {note && (
          <p className="s-notes" id={noteId}>
            {note}
          </p>
        )}
        <div className="s-actions">
          <button type="button" className="s-btn s-btn-quiet" onClick={onBack}>
            <span>{m.back()}</span>
          </button>
          <button
            type="submit"
            className="s-btn"
            aria-describedby={note ? noteId : undefined}
            disabled={busy}
          >
            <span>{m.pick_start()}</span>
          </button>
        </div>
      </form>
    </Prompt>
  );
}
