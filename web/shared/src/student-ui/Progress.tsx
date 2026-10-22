import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "react-aria-components/Button";
import { Dialog, DialogTrigger } from "react-aria-components/Dialog";
import { Popover } from "react-aria-components/Popover";
import { ProgressBar } from "react-aria-components/ProgressBar";
import { m } from "../paraglide/messages.js";
import { progressMode, SEGMENT_PITCH } from "./layout";
import "./student-ui.css";

export interface ProgressProps {
  /** Whether each question has an answer; its length is the question count. */
  answered: boolean[];
  /** Index of the current question, from 0. */
  current: number;
  onJump: (index: number) => void;
}

/**
 * Test progress for the bar above the sheet. It fills the width it is given
 * and shows one segment per question while they fit (see
 * {@link progressMode}), or a «7 / 40» button that opens a grid of every
 * question. Pressing a segment or a grid cell calls `onJump`.
 */
export function Progress({ answered, current, onJump }: ProgressProps) {
  const total = answered.length;
  const done = answered.filter(Boolean).length;
  const rootRef = useRef<HTMLDivElement>(null);
  const pitchRef = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<"segments" | "compact">("segments");

  useLayoutEffect(() => {
    const root = rootRef.current;
    const pitch = pitchRef.current;
    if (!root || !pitch) return;
    // The hidden pitch element is one segment wide in screen pixels.
    const update = () => {
      const scale = pitch.getBoundingClientRect().width / SEGMENT_PITCH;
      setMode(progressMode(total, root.clientWidth / scale));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => ro.disconnect();
  }, [total]);

  const label = (i: number) =>
    answered[i]
      ? m.progress_question_answered({ number: i + 1 })
      : m.progress_question_open({ number: i + 1 });
  const state = (i: number) => ({
    "data-on": answered[i] || undefined,
    "data-current": i === current || undefined,
    "aria-current": i === current ? ("step" as const) : undefined,
    "aria-label": label(i),
  });

  return (
    <div className="k-progress" ref={rootRef}>
      <span className="k-seg-pitch" ref={pitchRef} aria-hidden="true" />
      <ProgressBar
        className="k-sr-only"
        aria-label={m.progress_label()}
        value={done}
        maxValue={total}
        valueLabel={m.progress_value({ answered: done, total })}
      />
      {mode === "segments" ? (
        <div className="k-segs">
          {answered.map((_, i) => (
            <button
              key={i}
              type="button"
              className="k-seg"
              {...state(i)}
              onClick={() => onJump(i)}
            >
              <span className="k-seg-bar">
                <i />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <DialogTrigger>
          <Button
            className="k-prog-chip"
            aria-label={`${current + 1} / ${total}. ${m.progress_all()}`}
          >
            {current + 1} / {total}
          </Button>
          <Popover className="k-pop" placement="bottom">
            <Dialog className="k-qgrid" aria-label={m.progress_all()}>
              {({ close }) =>
                answered.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="k-qcell"
                    {...state(i)}
                    onClick={() => {
                      onJump(i);
                      close();
                    }}
                  >
                    {i + 1}
                  </button>
                ))
              }
            </Dialog>
          </Popover>
        </DialogTrigger>
      )}
    </div>
  );
}
