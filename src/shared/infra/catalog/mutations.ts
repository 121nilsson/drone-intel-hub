import type { CatalogMutations } from "@/shared/contracts/catalog";
import type { CatalogDeps } from "./shared";
import { mergeDrones } from "./merge";
import { removalImpact, removeDrone } from "./removal";
import { declineRelation, linkSystems, reviewRelation, unlinkSystems } from "./relations";
import { setOrigin } from "./origin";
import { splitVariant } from "./split";
import { markDistinct, setFlightProfile, setSystemClass } from "./classification";
import {
  moveSpecClaim,
  moveSpecClaimToSystem,
  reviewSpecClaim,
  undoSpecClaimToSystem,
  verdictForCorrection,
} from "./claims";
import {
  addAnalystAlias,
  moveAliasToSystem,
  reviewAliasClaim,
  undoAliasMoveFromSystem,
} from "./aliases";

/**
 * Binds the catalog operations to a set of repositories, so a page asks for "merge these two
 * entries" instead of assembling the repositories the operation happens to need.
 */
export function createCatalogMutations(d: CatalogDeps): CatalogMutations {
  return {
    merge: (keepId, mergeId, reason) => mergeDrones(keepId, mergeId, d, reason),
    removalImpact: (id) => removalImpact(id, d),
    remove: (id) => removeDrone(id, d),
    reviewClaim: (droneId, specKey, claim, verdict) =>
      reviewSpecClaim(droneId, specKey, claim, verdict, d),
    reviewCorrection: (droneId, specKey, claim, accept) => {
      const verdict = verdictForCorrection(claim, accept);
      return verdict ? reviewSpecClaim(droneId, specKey, claim, verdict, d) : undefined;
    },
    moveClaim: (droneId, specKey, claim, targetSpecKey, figure) =>
      moveSpecClaim(droneId, specKey, claim, targetSpecKey, figure ?? "", d),
    moveClaimToSystem: (droneId, specKey, claim, targetDroneId, targetSpecKey, figure) =>
      moveSpecClaimToSystem(droneId, specKey, claim, targetDroneId, targetSpecKey, figure ?? "", d),
    undoMoveClaimToSystem: (droneId, specKey, claim) =>
      undoSpecClaimToSystem(droneId, specKey, claim, d),
    reviewAlias: (droneId, claimId, verdict) => reviewAliasClaim(droneId, claimId, verdict, d),
    addAlias: (droneId, alias) => addAnalystAlias(droneId, alias, d),
    moveAlias: (sourceDroneId, claimId, targetDroneId) =>
      moveAliasToSystem(sourceDroneId, claimId, targetDroneId, d),
    undoMoveAlias: (sourceDroneId, claimId) => undoAliasMoveFromSystem(sourceDroneId, claimId, d),
    linkSystems: (sourceId, targetId, kind, role) => linkSystems(sourceId, targetId, kind, d, role),
    unlinkSystems: (sourceId, targetId) => unlinkSystems(sourceId, targetId, d),
    reviewRelation: (droneId, claimId, verdict, notes) =>
      reviewRelation(droneId, claimId, verdict, d, notes),
    setSystemClass: (droneId, systemClass) => setSystemClass(droneId, systemClass, d),
    setFlightProfile: (droneId, profile) => setFlightProfile(droneId, profile, d),
    declineRelation: (sourceId, targetId, kind) => declineRelation(sourceId, targetId, kind, d),
    markDistinct: (aId, bId) => markDistinct(aId, bId, d),
    setOrigin: (droneId, origin) => setOrigin(droneId, origin, d),
    splitVariant: (droneId, aliasClaimIds, claims) =>
      splitVariant(droneId, aliasClaimIds, claims, d),
  };
}
