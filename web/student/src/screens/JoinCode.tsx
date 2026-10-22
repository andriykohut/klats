import type { JoinInfo } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { motion, useAnimate, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { join } from "../api";
import { errorText, Problem, Prompt } from "./ui";

/**
 * The four-digit join code, typed into one numeric field drawn as four
 * cells. The fourth digit submits it, whether typed or pasted; `initial`, the
 * page's `?code=`, is filled in and submitted at once. A wrong code shakes the
 * cells and says so, and the next digit typed starts over.
 */
export function JoinCode({
  initial,
  onJoined,
}: {
  initial: string;
  onJoined: (code: string, info: JoinInfo) => void;
}) {
  const [code, setCode] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [cells, animate] = useAnimate();
  const reduced = useReducedMotionConfig();

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      onJoined(value, await join(value));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      input.current?.select();
      if (!reduced) {
        animate(
          cells.current,
          { x: [0, -12, 12, -8, 8, -4, 0] },
          { duration: 0.45 },
        );
      }
    }
  };

  // Submits the page's ?code= once, on arrival.
  useEffect(() => {
    if (/^\d{4}$/.test(initial)) void submit(initial);
  }, []);

  return (
    <Prompt title={m.join_title()} lead={m.join_hint()}>
      <div
        ref={cells}
        className="s-code"
        data-focused={focused || undefined}
        data-error={error ? true : undefined}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="s-cell"
            data-filled={code[i] ? true : undefined}
            data-current={i === Math.min(code.length, 3) || undefined}
          >
            {code[i] && (
              <motion.span
                key={code[i]}
                className="s-digit"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  visualDuration: 0.3,
                  bounce: 0.5,
                }}
              >
                {code[i]}
              </motion.span>
            )}
          </span>
        ))}
        <input
          ref={input}
          // biome-ignore lint/a11y/noAutofocus: the code is the only thing on the screen
          autoFocus
          aria-label={m.join_title()}
          aria-invalid={error ? true : undefined}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          value={code}
          readOnly={busy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "").slice(0, 4);
            setCode(value);
            setError(null);
            if (value.length === 4) void submit(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 4 && !busy) {
              void submit(code);
            }
          }}
        />
      </div>
      {error && <Problem>{error}</Problem>}
    </Prompt>
  );
}
