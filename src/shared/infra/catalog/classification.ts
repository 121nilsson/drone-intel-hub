import type { Drone, SystemClass } from "@/entities/drone/types";
import { withDistinct } from "@/entities/drone/system-hierarchy";
import type { CatalogDeps } from "./shared";

/** See CatalogMutations.markDistinct. */
export function markDistinct(
  aId: string,
  bId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const a = d.drones.get(aId);
  const b = d.drones.get(bId);
  if (!a || !b || a.id === b.id) return undefined;
  for (const [x, other] of [
    [b, aId],
    [a, bId],
  ] as const) {
    const apply = (fresh: Drone) => withDistinct(fresh, other, at);
    const next = apply(x);
    if (next !== x) d.drones.upsert(next, apply);
  }
  return d.drones.get(aId);
}

/** See CatalogMutations.setSystemClass. */
export function setSystemClass(
  droneId: string,
  systemClass: SystemClass | null,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const apply = (fresh: Drone): Drone => {
    const { systemClass: _old, ...rest } = fresh;
    void _old;
    return { ...rest, ...(systemClass ? { systemClass } : {}), updatedAt: at };
  };
  const next = apply(drone);
  d.drones.upsert(next, apply);
  return next;
}
