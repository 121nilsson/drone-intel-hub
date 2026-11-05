import type { Drone } from "@/entities/drone/types";
import type {
  CandidateRepository,
  DispatchRepository,
  DroneRepository,
} from "@/shared/contracts/repository";

/**
 * The repositories the catalog operations work on.
 *
 * The dispatch repository is optional: only the removal operations count feed posts, so a
 * caller without one still gets a correct (if smaller) report.
 */
export interface CatalogDeps {
  drones: DroneRepository;
  candidates: CandidateRepository;
  dispatches?: DispatchRepository;
}

/**
 * Whether another entry links to `id` through any legacy list or typed relation. Shared by the
 * merge (which re-points such links) and the removal (which drops them).
 */
export function linksTo(drone: Drone, id: string): boolean {
  return (
    (drone.relations ?? []).some((r) => r.targetSystemId === id) ||
    (drone.distinctFrom ?? []).includes(id) ||
    drone.counterpartIds.includes(id) ||
    drone.variantOfId === id ||
    (drone.variantIds?.includes(id) ?? false)
  );
}
