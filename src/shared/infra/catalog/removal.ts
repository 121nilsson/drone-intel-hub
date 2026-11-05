import type { Drone } from "@/entities/drone/types";
import { withoutRelationsTo } from "@/entities/drone/system-hierarchy";
import type { RemoveDroneReport } from "@/shared/contracts/catalog";
import type { CatalogDeps } from "./shared";
import { linksTo } from "./shared";

/**
 * What removing an entry would touch, without changing anything. The dossier shows this before
 * the analyst confirms.
 */
export function removalImpact(id: string, d: CatalogDeps): RemoveDroneReport {
  return {
    unlinked: d.drones.list().filter((x) => x.id !== id && linksTo(x, id)).length,
    discarded: d.candidates.list().filter((c) => c.resolvedInto === id).length,
    dispatches: (d.dispatches?.list() ?? []).filter((x) => x.droneIds?.includes(id)).length,
  };
}

/** Drop every link to a removed entry, keeping the rest of the document as it is. */
function unlinkAfterRemove(doc: Drone, id: string, at: string): Drone {
  if (!linksTo(doc, id)) return doc;
  const unlinked = withoutRelationsTo(doc, id, at);
  return unlinked.distinctFrom?.includes(id)
    ? { ...unlinked, distinctFrom: unlinked.distinctFrom.filter((x) => x !== id), updatedAt: at }
    : unlinked;
}

/**
 * Remove a catalog entry an analyst has judged wrong (a unit or an outlet promoted as a system).
 *
 * Nothing is left pointing at it: other entries lose their links to it, feed posts drop it from
 * their provenance, and the candidates that created or fed it become "discarded by the analyst".
 * That last part is also what keeps it out: auto-promotion refuses a name an analyst has rejected
 * (see rejectedByAnalyst), so the next post naming it goes to the Queue instead of straight back
 * into the catalog. The candidates keep `resolvedInto` as history; the Queue shows it as deleted.
 */
export function removeDrone(id: string, d: CatalogDeps): RemoveDroneReport | undefined {
  if (!d.drones.get(id)) return undefined;
  const report: RemoveDroneReport = { unlinked: 0, discarded: 0, dispatches: 0 };
  const now = new Date().toISOString();

  for (const other of d.drones.list()) {
    if (other.id === id || !linksTo(other, id)) continue;
    d.drones.upsert(unlinkAfterRemove(other, id, now), (fresh) =>
      unlinkAfterRemove(fresh, id, now),
    );
    report.unlinked++;
  }

  for (const c of d.candidates.list()) {
    if (c.resolvedInto !== id) continue;
    d.candidates.update(c.id, { status: "discarded", resolvedBy: "analyst" });
    report.discarded++;
  }

  for (const post of d.dispatches?.list() ?? []) {
    if (!post.droneIds?.includes(id)) continue;
    d.dispatches!.update(post.id, { droneIds: post.droneIds.filter((x) => x !== id) });
    report.dispatches++;
  }

  d.drones.remove?.(id);
  return report;
}
