import { clusterEvents } from "@/entities/dispatch/events";
import type { DispatchRepository } from "@/shared/contracts/repository";

/**
 * Correlate the analysed archive into events and stamp the ids on the dispatches. Only members
 * of a real cluster get one, and only when it changed, so a re-run is idempotent. Runs after a
 * batch: the correlation is about what the archive now holds, not about one dispatch.
 */
export function stampEvents(dispatches: DispatchRepository): number {
  const list = dispatches.list();
  const clusters = clusterEvents(list);
  if (clusters.size === 0) {
    // Clusters can also *lose* a member (a claim retracted, a merge collapsed two systems), so
    // a stale stamp is cleared even when nothing clusters this run.
    return list
      .filter((d) => d.eventId)
      .reduce((n, d) => {
        dispatches.update(d.id, { eventId: undefined });
        return n + 1;
      }, 0);
  }
  let changed = 0;
  for (const d of list) {
    const eventId = clusters.get(d.id);
    if (eventId !== d.eventId) {
      dispatches.update(d.id, eventId ? { eventId } : { eventId: undefined });
      changed++;
    }
  }
  return changed;
}
