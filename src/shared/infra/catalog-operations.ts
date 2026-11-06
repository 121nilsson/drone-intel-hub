/**
 * The catalog operations behind CatalogMutations, split by operation group under ./catalog/.
 * This file stays as the public entry point so existing importers do not change.
 */
export type { CatalogDeps } from "./catalog/shared";
export { mergeDrones } from "./catalog/merge";
export { removalImpact, removeDrone } from "./catalog/removal";
export { declineRelation, linkSystems, reviewRelation, unlinkSystems } from "./catalog/relations";
export { setOrigin } from "./catalog/origin";
export { splitVariant } from "./catalog/split";
export { markDistinct, setFlightProfile, setSystemClass } from "./catalog/classification";
export {
  moveSpecClaim,
  moveSpecClaimToSystem,
  reviewSpecClaim,
  undoSpecClaimToSystem,
  verdictForCorrection,
} from "./catalog/claims";
export {
  addAnalystAlias,
  moveAliasToSystem,
  reviewAliasClaim,
  undoAliasMoveFromSystem,
} from "./catalog/aliases";
export { createCatalogMutations } from "./catalog/mutations";
