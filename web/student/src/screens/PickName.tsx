import type { JoinInfo, Participant } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useState } from "react";
import {
  RadioButton,
  RadioField,
  RadioGroup,
} from "react-aria-components/RadioGroup";
import { pick } from "../api";
import { errorText, Problem, Sheet } from "./ui";

/**
 * The class list as name tiles, in the server's order, with a filter field
 * for long lists. Names another computer holds are disabled and marked
 * «вже в тесті». The student picks a name, then starts the test with it.
 */
export function PickName({
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLocaleLowerCase("uk");
  const shown = info.names.filter((n) =>
    n.name.toLocaleLowerCase("uk").includes(q),
  );

  const start = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      onPicked(await pick(code, { studentId: selected }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Sheet className="s-pick">
      <div className="s-pick-head">
        <h1 className="s-h1">{m.pick_title()}</h1>
        <input
          className="s-field s-search"
          type="search"
          placeholder={m.pick_search()}
          aria-label={m.pick_search()}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="s-names-scroll">
        <RadioGroup
          className="s-names"
          aria-label={m.pick_title()}
          value={selected}
          onChange={(id) => {
            setSelected(id);
            setError(null);
          }}
        >
          {shown.map((n) => (
            <RadioField
              key={n.studentId}
              value={n.studentId}
              isDisabled={n.taken}
              className="k-tile-field"
            >
              <RadioButton className="k-tile">
                <span className="k-face">
                  <span className="k-badge k-badge-single" aria-hidden="true">
                    <span className="k-badge-dot" />
                  </span>
                  <span className="k-tile-text">{n.name}</span>
                  {n.taken && <span className="s-taken">{m.pick_taken()}</span>}
                </span>
              </RadioButton>
            </RadioField>
          ))}
        </RadioGroup>
        {shown.length === 0 && <p className="s-empty">{m.pick_none()}</p>}
      </div>
      <div className="s-foot">
        <button type="button" className="s-btn s-btn-quiet" onClick={onBack}>
          <span>{m.back()}</span>
        </button>
        {error && <Problem>{error}</Problem>}
        <button
          type="button"
          className="s-btn"
          disabled={!selected || busy}
          onClick={start}
        >
          <span>{m.pick_start()}</span>
        </button>
      </div>
    </Sheet>
  );
}
