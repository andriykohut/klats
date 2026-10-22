import { m } from "@klats/shared/paraglide/messages.js";
import { useState } from "react";
import { normalizeAddress } from "../api";
import { ICONS, Notice, Problem } from "./ui";

/**
 * A field for the teacher's new address, when the teacher's computer moved
 * to another one. A valid address goes to `onConnect` as an origin (see
 * {@link normalizeAddress}); anything else gets an inline error.
 */
export function AddressChanged({
  onConnect,
  onCancel,
}: {
  onConnect: (url: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);

  return (
    <Notice icon={ICONS.network} title={m.address_title()}>
      <p className="s-lead">{m.address_hint()}</p>
      <form
        className="s-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const url = normalizeAddress(value);
          if (url) onConnect(url);
          else setBad(true);
        }}
      >
        <input
          className="s-field"
          // biome-ignore lint/a11y/noAutofocus: the address is all this screen asks for
          autoFocus
          aria-label={m.address_label()}
          aria-invalid={bad || undefined}
          placeholder="10.0.0.5:8080"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setBad(false);
          }}
        />
        {bad && <Problem>{m.address_bad()}</Problem>}
        <div className="s-actions">
          <button
            type="button"
            className="s-btn s-btn-quiet"
            onClick={onCancel}
          >
            <span>{m.address_cancel()}</span>
          </button>
          <button type="submit" className="s-btn">
            <span>{m.address_connect()}</span>
          </button>
        </div>
      </form>
    </Notice>
  );
}
