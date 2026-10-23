import type { NetworkInfo } from "@klats/shared/generated/wire.ts";
import type { QueryClient } from "@tanstack/react-query";
import { getNetwork } from "./api/client";
import { setFlags } from "./flags";

/**
 * Follows the teacher event stream until the returned function is called.
 * A "live" event refetches the live view and the results shown, which late
 * answers and the end of a sitting change. "address_changed" refetches the
 * network info and raises the address banner if the students' URL differs
 * from the one held before; the server reports any change to the candidate
 * addresses, even one that leaves the chosen URL as it was. EventSource
 * reconnects by itself after a dropped connection, and each (re)connect
 * refetches the live view in case a "live" event was missed meanwhile.
 */
export function subscribeTeacherEvents(queryClient: QueryClient): () => void {
  const es = new EventSource("/api/events");
  const refetchLive = () => {
    for (const key of ["live", "assignments", "results"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  es.addEventListener("open", refetchLive);
  es.addEventListener("live", refetchLive);
  es.addEventListener("address_changed", () => {
    const before = queryClient.getQueryData<NetworkInfo>(["network"])?.url;
    queryClient
      .fetchQuery({ queryKey: ["network"], queryFn: getNetwork, staleTime: 0 })
      .then(
        (info) => info.url !== before && setFlags({ addressChanged: true }),
        () => {}, // unreachable server: the next event or refetch catches up
      );
  });
  return () => es.close();
}
