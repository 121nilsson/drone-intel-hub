import type { Drone, SpecClaim } from "@/entities/drone/types";
import {
  addAnalystClaim,
  claimKey,
  fileMovedClaim,
  markClaimMovedToSystem,
  moveClaim,
  removeMovedClaim,
  reviewClaim,
} from "@/entities/drone/claim-review";
import type { ClaimVerdict } from "@/shared/contracts/catalog";
import type { CatalogDeps } from "./shared";

/** See CatalogMutations.reviewClaim. */
export function reviewSpecClaim(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  verdict: ClaimVerdict | null,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const apply = (base: Drone): Drone | undefined => {
    let next = reviewClaim(
      base,
      specKey,
      claim,
      verdict
        ? {
            verdict: verdict.verdict,
            ...(verdict.verdict === "rejected" ? { issue: verdict.issue } : {}),
            at,
            by: "analyst",
          }
        : null,
    );
    if (next && verdict?.verdict === "rejected" && verdict.correctValue?.trim()) {
      next = addAnalystClaim(next, specKey, verdict.correctValue, at) ?? next;
    }
    return next;
  };
  const next = apply(drone);
  if (next) d.drones.upsert(next, (fresh) => apply(fresh) ?? fresh);
  return next;
}

/** See CatalogMutations.reviewCorrection. */
export function verdictForCorrection(claim: SpecClaim, accept: boolean): ClaimVerdict | null {
  const fix = claim.autoCorrection;
  if (!fix) return null;
  if (!accept) return { verdict: "confirmed" };
  if (fix.kind === "implausible" || fix.value === undefined)
    return { verdict: "rejected", issue: "value" };
  return {
    verdict: "rejected",
    issue: "unit",
    correctValue: fix.unit ? `${fix.value} ${fix.unit}` : String(fix.value),
  };
}

/** See CatalogMutations.moveClaim. */
export function moveSpecClaim(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  targetSpecKey: string,
  figure: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const drone = d.drones.get(droneId);
  if (!drone) return undefined;
  const key = claimKey(claim);
  // A retry must not file the same moved claim twice if the target already received it.
  const hasCopy = (base: Drone) =>
    base.specs.find((s) => s.key === targetSpecKey)?.claims.some((c) => c.movedFrom === key) ??
    false;
  if (hasCopy(drone)) return drone;
  const apply = (base: Drone) =>
    hasCopy(base) ? base : (moveClaim(base, specKey, claim, targetSpecKey, figure, at) ?? base);
  const next = moveClaim(drone, specKey, claim, targetSpecKey, figure, at);
  if (next) d.drones.upsert(next, apply);
  return next;
}

/** See CatalogMutations.moveClaimToSystem. */
export function moveSpecClaimToSystem(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  targetDroneId: string,
  targetSpecKey: string,
  figure: string,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(droneId);
  const target = d.drones.get(targetDroneId);
  if (!source || !target || source.id === target.id) return undefined;
  const key = claimKey(claim);
  const sourceNext = markClaimMovedToSystem(
    source,
    specKey,
    claim,
    targetDroneId,
    targetSpecKey,
    at,
  );
  const targetNext = fileMovedClaim(target, targetSpecKey, claim, droneId, key, figure, at);
  if (!sourceNext || !targetNext) return undefined;
  if (sourceNext === source && targetNext === target) return source;

  // Two documents cannot be written atomically. File the target first: if the source write then
  // fails, the figure is briefly counted twice, which a retry/undo repairs - the other order
  // would reject the source claim and lose the figure entirely.
  if (targetNext !== target) {
    d.drones.upsert(targetNext, (fresh) => {
      const filed = fileMovedClaim(fresh, targetSpecKey, claim, droneId, key, figure, at);
      return filed ?? fresh;
    });
  }
  d.drones.upsert(sourceNext, (fresh) => {
    const moved = markClaimMovedToSystem(fresh, specKey, claim, targetDroneId, targetSpecKey, at);
    return moved ?? fresh;
  });
  return sourceNext;
}

/** See CatalogMutations.undoMoveClaimToSystem. */
export function undoSpecClaimToSystem(
  droneId: string,
  specKey: string,
  claim: SpecClaim,
  d: Pick<CatalogDeps, "drones">,
  at = new Date().toISOString(),
): Drone | undefined {
  const source = d.drones.get(droneId);
  if (!source) return undefined;
  const spec = source.specs.find((s) => s.key === specKey);
  const key = claimKey(claim);
  const current = spec?.claims.find((c) => claimKey(c) === key);
  const review = current?.review;
  if (!spec || !current || !review?.movedToDroneId) return undefined;

  const targetDroneId = review.movedToDroneId;
  const targetSpecKey = review.movedTo;
  const moveId = review.moveId;
  const next = reviewClaim(source, specKey, claim, null, at);
  if (!next) return undefined;
  // Clear the source verdict first: a failed target write leaves a visible duplicate, never a
  // silently discarded figure.
  d.drones.upsert(next, (fresh) => reviewClaim(fresh, specKey, claim, null, at) ?? fresh);
  const target = d.drones.get(targetDroneId);
  if (target) {
    const removed = removeMovedClaim(target, droneId, key, targetSpecKey, at, moveId);
    if (removed !== target) {
      d.drones.upsert(removed, (fresh) =>
        removeMovedClaim(fresh, droneId, key, targetSpecKey, at, moveId),
      );
    }
  }
  return next;
}
