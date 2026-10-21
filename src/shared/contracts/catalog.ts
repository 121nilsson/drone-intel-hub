import type { ClaimIssue, Drone, SpecClaim } from "@/entities/drone/types";

/**
 * What removing a catalog entry would touch, without changing anything.
 *
 * The dossier shows this before the analyst confirms, so the number is a preview of the
 * consequences, not a promise: it counts what exists at the moment of the call.
 */
export interface RemoveDroneReport {
  /** Other catalog entries whose counterpart or variant links pointed at the removed one. */
  unlinked: number;
  /** Candidates that had been promoted or merged into it, now discarded by the analyst. */
  discarded: number;
  /** Feed posts whose provenance listed it. */
  dispatches: number;
}

/**
 * Catalog-level operations that span more than one collection.
 *
 * A page asks for the operation - "merge these two entries", "what would removing this
 * touch" - and never assembles the repositories the operation happens to work on. The
 * implementation in `src/shared/infra/catalog-operations.ts` decides that, and the
 * composition root binds them to the live repositories.
 */
export interface CatalogMutations {
  /**
   * Fold `mergeId` into `keepId`, preserving every claim of both, and remove the merged
   * entry. Returns the merged entry, or undefined when either id is unknown or they are
   * the same entry.
   */
  merge(keepId: string, mergeId: string, reason?: string): Drone | undefined;
  /** What removing an entry would touch, without changing anything. */
  removalImpact(id: string): RemoveDroneReport;
  /**
   * Remove an entry and everything pointing at it: other entries lose their links to it,
   * feed posts drop it from their provenance, and the candidates that created or fed it
   * become "discarded by the analyst".
   */
  remove(id: string): RemoveDroneReport | undefined;
  /**
   * Record an analyst's verdict on one spec claim: "confirmed", rejected for an `issue`, or
   * null to clear an earlier verdict. A rejected claim stays on the record but stops feeding
   * consensus. With `correctValue`, the value the analyst says is right is added as a confirmed
   * claim of its own. Returns the updated entry, or undefined when the entry, spec or claim is
   * gone.
   */
  reviewClaim(
    droneId: string,
    specKey: string,
    claim: SpecClaim,
    verdict: ClaimVerdict | null,
  ): Drone | undefined;
  /**
   * The analyst's answer to the corrector's finding on a claim. Accepting a unit correction rejects
   * the figure as misread and adds the corrected value as the analyst's; accepting an implausible
   * finding rejects the figure; keeping confirms the figure as written. Either way the finding
   * stays on the claim, since it is what the corrector's trust is measured on.
   */
  reviewCorrection(
    droneId: string,
    specKey: string,
    claim: SpecClaim,
    accept: boolean,
  ): Drone | undefined;
  /**
   * Move a claim to another attribute of the same system: the claim stays on the record where
   * the post put it but stops counting there, and the figure is filed under the attribute the
   * analyst says it describes. `figure` is the reading in the target attribute ("600 km/h");
   * without it the claim keeps its own number and the target's unit applies.
   */
  moveClaim(
    droneId: string,
    specKey: string,
    claim: SpecClaim,
    targetSpecKey: string,
    figure?: string,
  ): Drone | undefined;
}

export type ClaimVerdict =
  { verdict: "confirmed" } | { verdict: "rejected"; issue: ClaimIssue; correctValue?: string };
