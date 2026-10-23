import type { Counts } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { initials, shortName } from "./journal";

/**
 * The line over the journal: how many are in the test (of the class list),
 * finished and offline, and who on the class list has not joined yet, by
 * initials only while names are `hidden`. A sitting without a class list has
 * no one to wait for, so it shows no such list.
 */
export function Summary({
  counts,
  hidden,
}: {
  counts: Counts;
  hidden: boolean;
}) {
  const waiting = counts.notJoined.map(hidden ? initials : shortName);
  return (
    <div className="l-sum">
      <p className="l-stat">
        <b>{counts.inTest}</b>
        {counts.classSize > 0
          ? m.live_in_test_of({ total: counts.classSize })
          : m.live_in_test()}
      </p>
      <p className="l-stat">
        <b>{counts.finished}</b>
        {m.live_finished()}
      </p>
      <p className="l-stat" data-tone="offline">
        <b>{counts.offline}</b>
        {m.live_offline()}
      </p>
      {counts.classSize > 0 && (
        <p className="l-wait">
          {waiting.length > 0
            ? m.live_not_joined({ names: waiting.join(", ") })
            : m.live_all_joined()}
        </p>
      )}
    </div>
  );
}
