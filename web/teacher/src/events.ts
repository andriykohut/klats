import type { QueryClient } from "@tanstack/react-query";
import { setFlags } from "./flags";

/**
 * Follows the teacher event stream until the returned function is called.
 * A "live" event refetches the live view; "address_changed" refetches the
 * network info and raises the address banner. EventSource reconnects by
 * itself after a dropped connection, and each (re)connect refetches the live
 * view in case a "live" event was missed meanwhile.
 */
export function subscribeTeacherEvents(queryClient: QueryClient): () => void {
  const es = new EventSource("/api/events");
  const refetchLive = () =>
    queryClient.invalidateQueries({ queryKey: ["live"] });
  es.addEventListener("open", refetchLive);
  es.addEventListener("live", refetchLive);
  es.addEventListener("address_changed", () => {
    setFlags({ addressChanged: true });
    queryClient.invalidateQueries({ queryKey: ["network"] });
  });
  return () => es.close();
}
