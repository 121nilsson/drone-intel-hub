import type { Drone, RelationKind } from "@/entities/drone/types";
import {
  relationProblem,
  withDeclinedRelation,
  withRelation,
  withRelationReview,
  withUnlink,
} from "@/entities/drone/system-hierarchy";
import type { CatalogDeps } from "./shared";

/** See CatalogMutations.linkSystems. */
export function linkSystems(
  sourceId: string,
  targetId: string,
  kind: RelationKind,
  d: Pick<CatalogDeps, "drones">,
  role?: string,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceId);
  const target = d.drones.get(targetId);
  if (!source || !target) return undefined;
  const catalog = d.drones.list();
  if (relationProblem(source, target, kind, catalog)) return undefined;
  const apply = (fresh: Drone) => withRelation(fresh, target, kind, d.drones.list(), at, role);
  const next = apply(source);
  d.drones.upsert(next, apply);
  return next;
}

/** See CatalogMutations.unlinkSystems. */
export function unlinkSystems(
  sourceId: string,
  targetId: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceId);
  const target = d.drones.get(targetId);
  if (!source || !target) return undefined;
  // Both sides, each recording the unlink: a counterpart is listed on each, a parent may list its
  // variant, and a report naming both would otherwise bring the link back.
  const unlinkSource = (fresh: Drone) => withUnlink(fresh, d.drones.get(targetId) ?? target, at);
  const unlinkTarget = (fresh: Drone) => withUnlink(fresh, d.drones.get(sourceId) ?? source, at);
  const next = unlinkSource(source);
  const t = unlinkTarget(target);
  if (next !== source) d.drones.upsert(next, unlinkSource);
  if (t !== target) d.drones.upsert(t, unlinkTarget);
  return next;
}

/** See CatalogMutations.reviewRelation. */
export function reviewRelation(
  droneId: string,
  claimId: string,
  verdict: "confirmed" | "rejected" | null,
  d: Pick<CatalogDeps, "drones">,
  notes?: string,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const next = withRelationReview(drone, claimId, verdict, at, notes);
  if (!next) return undefined;
  d.drones.upsert(next, (fresh) => withRelationReview(fresh, claimId, verdict, at, notes) ?? fresh);
  const claim = drone.relations?.find((r) => r.id === claimId);
  if (verdict === "rejected" && claim?.kind === "variant_of")
    dropFromVariantList(claim.targetSystemId, droneId, d, at);
  if (verdict === "rejected" && claim?.kind === "counterpart_to")
    dropFromCounterparts(claim.targetSystemId, droneId, d, at);
  return next;
}

/** See CatalogMutations.declineRelation. */
export function declineRelation(
  sourceId: string,
  targetId: string,
  kind: RelationKind,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(sourceId);
  if (!source) return undefined;
  const apply = (fresh: Drone) => withDeclinedRelation(fresh, targetId, kind, at);
  const next = apply(source);
  if (next !== source) d.drones.upsert(next, apply);
  if (kind === "variant_of") dropFromVariantList(targetId, sourceId, d, at);
  if (kind === "counterpart_to") dropFromCounterparts(targetId, sourceId, d, at);
  return next;
}

/** A turned-down counterpart leaves the other side's legacy list too: the pipeline lists both. */
function dropFromCounterparts(
  otherId: string,
  droneId: string,
  d: Pick<CatalogDeps, "drones">,
  at: string,
) {
  const other = d.drones.get(otherId);
  if (!other?.counterpartIds.includes(droneId)) return;
  const apply = (fresh: Drone): Drone =>
    fresh.counterpartIds.includes(droneId)
      ? {
          ...fresh,
          counterpartIds: fresh.counterpartIds.filter((id) => id !== droneId),
          updatedAt: at,
        }
      : fresh;
  d.drones.upsert(apply(other), apply);
}

/** A turned-down variant leaves its parent's legacy list too, for the readers that use it. */
function dropFromVariantList(
  parentId: string,
  childId: string,
  d: Pick<CatalogDeps, "drones">,
  at: string,
) {
  const parent = d.drones.get(parentId);
  if (!parent?.variantIds?.includes(childId)) return;
  const apply = (fresh: Drone): Drone =>
    fresh.variantIds?.includes(childId)
      ? { ...fresh, variantIds: fresh.variantIds.filter((id) => id !== childId), updatedAt: at }
      : fresh;
  d.drones.upsert(apply(parent), apply);
}
