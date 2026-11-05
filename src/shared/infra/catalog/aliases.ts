import type { Drone } from "@/entities/drone/types";
import {
  addManualAlias,
  approveAlias,
  moveAliasTo,
  rejectAlias,
  removeFiledAlias,
  unsetAliasVerdict,
} from "@/entities/drone/alias-claims";
import type { CatalogDeps } from "./shared";

/** See CatalogMutations.reviewAlias. */
export function reviewAliasClaim(
  droneId: string,
  claimId: string,
  verdict: "confirmed" | "rejected" | null,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const apply = (base: Drone): Drone | undefined =>
    verdict === "confirmed"
      ? approveAlias(base, claimId, at)
      : verdict === "rejected"
        ? rejectAlias(base, claimId, at)
        : unsetAliasVerdict(base, claimId, at);
  const next = apply(drone);
  if (next) d.drones.upsert(next, (fresh) => apply(fresh) ?? fresh);
  return next;
}

/** See CatalogMutations.addAlias. */
export function addAnalystAlias(
  droneId: string,
  alias: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const next = addManualAlias(drone, alias, at);
  if (next) d.drones.upsert(next, (fresh) => addManualAlias(fresh, alias, at) ?? fresh);
  return next;
}

/** See CatalogMutations.moveAlias. */
export function moveAliasToSystem(
  sourceDroneId: string,
  claimId: string,
  targetDroneId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceDroneId);
  const target = d.drones.get(targetDroneId);
  if (!source || !target) return undefined;
  const first = moveAliasTo(source, claimId, target, at);
  if (!first) return undefined;
  // Two documents cannot be written atomically. The copy lands first: if the source write then
  // fails, the alias is briefly answered to twice, which a retry or undo repairs - the other
  // order would reject the source claim and lose the alias entirely.
  if (first.target !== target) {
    d.drones.upsert(first.target, (fresh) => {
      const result = moveAliasTo(d.drones.get(sourceDroneId) ?? source, claimId, fresh, at);
      return result?.target ?? fresh;
    });
  }
  if (first.source !== source) {
    d.drones.upsert(
      first.source,
      (fresh) => moveAliasTo(fresh, claimId, target, at)?.source ?? fresh,
    );
  }
  return first.source;
}

/** See CatalogMutations.undoMoveAlias. */
export function undoAliasMoveFromSystem(
  sourceDroneId: string,
  claimId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceDroneId);
  if (!source) return undefined;
  const claim = source.aliasClaims?.find((c) => c.id === claimId);
  const moveId = claim?.review?.moveId;
  if (!claim || !moveId) return undefined;
  const targetDroneId = claim.review?.movedToDroneId;
  const next = unsetAliasVerdict(source, claimId, at);
  if (!next) return undefined;
  // Clear the source verdict first: a failed target write leaves the filed copy in place -
  // visible - rather than discarding the alias silently.
  d.drones.upsert(next, (fresh) => unsetAliasVerdict(fresh, claimId, at) ?? fresh);
  if (!targetDroneId) return next;
  const target = d.drones.get(targetDroneId);
  if (target) {
    const removed = removeFiledAlias(target, sourceDroneId, moveId, at);
    if (removed !== target) {
      d.drones.upsert(removed, (fresh) => removeFiledAlias(fresh, sourceDroneId, moveId, at));
    }
  }
  return next;
}
