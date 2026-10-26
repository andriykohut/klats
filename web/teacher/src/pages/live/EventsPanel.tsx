import type { Event, LiveRow } from "@klats/shared/generated/wire.ts";
import { gradeText } from "@klats/shared/grades.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { getLocale } from "@klats/shared/paraglide/runtime.js";
import { type ReactNode, useState } from "react";
import { Button } from "react-aria-components";
import { busy, useResolveEvent } from "../../api/queries";
import { cooldown } from "../../cooldown";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { withBold } from "../../ui/withBold";

type Tone = "red" | "tang" | "mint" | undefined;

/**
 * «Події»: the events waiting for a decision first, each with its actions,
 * then the rest, newest first, as the live snapshot lists them. A name clash
 * offers «Перенести на …» only while the name's current holder is offline,
 * and asks before it disconnects the holder, as the row menu's kick does,
 * since the holder's answers then stop counting. `who` is how a name shows
 * (initials while names are hidden), in the confirmation too; hidden names
 * also hide the grade a student finished with. A student who finished with a
 * written answer waiting for the teacher gets «чекає перевірки» in place of a
 * grade.
 */
export function EventsPanel(props: {
  events: Event[];
  rows: LiveRow[];
  who: (name: string) => string;
  hidden: boolean;
  scale: string;
}) {
  const resolve = useResolveEvent();
  // The next clash's buttons slide under the pointer once one is resolved.
  const [mayAct] = useState(() => cooldown());
  const [kicking, setKicking] = useState<Event | null>(null);
  const time = new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
  const act = (id: string, action: string) => {
    if (busy("resolve") || !mayAct()) return;
    resolve.mutate({ id, action });
  };

  return (
    <section className="t-panel l-events" aria-labelledby="l-events-title">
      <h2 id="l-events-title">{m.live_events()}</h2>
      {props.events.length === 0 ? (
        <p className="l-events-none">{m.live_no_events()}</p>
      ) : (
        <ol>
          {props.events.map((ev) => {
            const { tone, text } = describe(
              ev,
              props.who,
              props.hidden,
              props.scale,
            );
            const actions = ev.pinned ? clashActions(ev, props.rows) : [];
            return (
              <li key={ev.id} className="l-ev" data-tone={tone}>
                <span className="l-ev-dot" aria-hidden="true" />
                <div>
                  <p>{text}</p>
                  <time dateTime={new Date(ev.at).toISOString()}>
                    {time.format(ev.at)}
                  </time>
                  {actions.length > 0 && (
                    <div className="l-ev-acts">
                      {actions.map((a) => (
                        <Button
                          key={a.action}
                          className="l-ev-act"
                          onPress={() =>
                            a.action === "kick_old"
                              ? setKicking(ev)
                              : act(ev.id, a.action)
                          }
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <ConfirmDialog
        isOpen={kicking !== null}
        onOpenChange={(open) => !open && setKicking(null)}
        title={m.live_kick_title({
          name: props.who(kicking?.params.name ?? ""),
        })}
        confirm={m.live_kick()}
        pending={resolve.isPending}
        onConfirm={() => {
          if (!kicking || busy("resolve")) return;
          resolve.mutate(
            { id: kicking.id, action: "kick_old" },
            { onSuccess: () => setKicking(null) },
          );
        }}
      >
        {m.live_kick_text()}
      </ConfirmDialog>
    </section>
  );
}

/**
 * The buttons of a pending name clash, in the server's order. The move is
 * left out while the holder's row is not offline: a holder still writing
 * would lose the name to a classmate who picked it by mistake.
 */
function clashActions(
  ev: Event,
  rows: LiveRow[],
): { action: string; label: string }[] {
  const p = ev.params;
  const holder = rows.find((r) => r.participantId === p.participantId);
  const labels: Record<string, string> = {
    kick_old: m.ev_kick({ label: p.holder ?? "" }),
    kick_new: m.ev_kick({ label: p.newcomer ?? "" }),
    move: m.ev_move({ label: p.newcomer ?? "" }),
  };
  return ev.actions
    .filter(
      (a) => a in labels && (a !== "move" || holder?.status === "offline"),
    )
    .map((a) => ({ action: a, label: labels[a] }));
}

/** The text and colour of an event; a kind this version does not know gets a neutral line. */
function describe(
  ev: Event,
  who: (name: string) => string,
  hidden: boolean,
  scale: string,
): { tone: Tone; text: ReactNode } {
  const p = ev.params;
  const name = who(p.name ?? "");
  switch (ev.kind) {
    case "name_clash": {
      const params = {
        name,
        holder: p.holder ?? "",
        newcomer: p.newcomer ?? "",
      };
      return ev.pinned
        ? { tone: "red", text: m.ev_clash(params) }
        : { tone: undefined, text: m.ev_clash_done(params) };
    }
    case "joined":
      return {
        tone: undefined,
        text: m.ev_joined({ name, label: p.label ?? "" }),
      };
    case "offline":
      return { tone: "tang", text: m.ev_offline({ name }) };
    case "online":
      return {
        tone: "mint",
        text:
          Number(p.synced) > 0
            ? m.ev_online_synced({ name, count: p.synced })
            : m.ev_online({ name }),
      };
    case "window_switch":
      return {
        tone: "tang",
        text:
          Number(p.count) > 1
            ? m.ev_switch_again({ name, count: p.count })
            : m.ev_switch({ name }),
      };
    case "finished":
      return {
        tone: "mint",
        text: hidden
          ? m.ev_finished_hidden({ name })
          : p.pending === "true"
            ? withBold(m.ev_finished_pending.parts({ name }), "l-ev-grade")
            : withBold(
                m.ev_finished.parts({
                  name,
                  grade: gradeText(scale, Number(p.grade)),
                }),
                "l-ev-grade",
              ),
      };
    case "late_answers":
      return { tone: "tang", text: m.ev_late({ name, count: p.count ?? "" }) };
    case "overtime_answers":
      return {
        tone: "tang",
        text: m.ev_overtime({ name, count: p.count ?? "" }),
      };
    case "extra_time":
      return {
        tone: undefined,
        text: m.ev_extra_time({ name, minutes: p.minutes ?? "" }),
      };
    default:
      return { tone: undefined, text: m.ev_unknown() };
  }
}
