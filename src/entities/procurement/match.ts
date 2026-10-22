import type { Drone } from "@/entities/drone/types";
import type { Procurement } from "./types";

const norm = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/** Names a contract may use for a system: canonical, Cyrillic and aliases. */
function droneNames(drone: Drone): Set<string> {
  return new Set(
    [drone.name, drone.cyrillic, ...drone.aliases]
      .filter((name): name is string => Boolean(name?.trim()))
      .map(norm),
  );
}

/**
 * Contracts that name a system. Matching is exact on a catalog id, a system name or an alias;
 * `product` is only used when the extractor stored a system name there (older records). Deliberately
 * not substring matching: "FPV drones" must not attach every FPV contract to every FPV system.
 */
export function contractsForDrone(
  procurements: readonly Procurement[],
  drone: Drone,
): Procurement[] {
  const names = droneNames(drone);
  const named = (value: string | undefined) => Boolean(value && names.has(norm(value)));
  return procurements
    .filter(
      (p) => p.systemIds?.includes(drone.id) || p.systemNames?.some(named) || named(p.product),
    )
    .sort(byNewestContract);
}

/** Newest announcement first; the record's creation date is the fallback for undated reports. */
export function byNewestContract(a: Procurement, b: Procurement): number {
  const at = Date.parse(a.announcedAt ?? a.createdAt);
  const bt = Date.parse(b.announcedAt ?? b.createdAt);
  return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
}
