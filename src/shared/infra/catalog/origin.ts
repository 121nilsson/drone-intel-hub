import type { Drone } from "@/entities/drone/types";
import { decideOrigin } from "@/entities/drone/origin-audit";
import type { CatalogDeps } from "./shared";

/** See CatalogMutations.setOrigin. */
export function setOrigin(
  droneId: string,
  origin: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone || !origin.trim()) return undefined;
  const apply = (fresh: Drone) => decideOrigin(fresh, origin, at);
  const next = apply(drone);
  d.drones.upsert(next, apply);
  return next;
}
