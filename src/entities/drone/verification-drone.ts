import type { Drone, SpecClaim } from "./types";
import { sameVerification, verifyClaim } from "./verification-claim";

export type ClaimTextResolver = (claim: SpecClaim) => string | undefined;

/**
 * Verify every claim of an entry, with each claim's own source text supplied by `textFor`.
 * `shouldVerify` lets the ingest path verify only the claims a post just added, so old claims
 * are not re-checked against another post's text. Claims the analyst entered are left untouched.
 */
export function verifyDrone(
  drone: Drone,
  textFor: ClaimTextResolver,
  catalog: readonly Drone[] = [],
  at = new Date().toISOString(),
  shouldVerify: (claim: SpecClaim) => boolean = () => true,
): Drone {
  let changed = false;
  const specs = drone.specs.map((spec) => {
    let specChanged = false;
    const claims = spec.claims.map((claim) => {
      if (!shouldVerify(claim)) return claim;
      const verification = verifyClaim({ drone, spec, claim, text: textFor(claim), catalog, at });
      if (!verification || sameVerification(claim.verification, verification)) return claim;
      specChanged = true;
      changed = true;
      return { ...claim, verification };
    });
    return specChanged ? { ...spec, claims } : spec;
  });
  return changed ? { ...drone, specs } : drone;
}

/**
 * Verify only the claims a post just added, against that post's text.
 *
 * `known` is the set of claim ids that existed before the write, so a merge never re-checks an
 * older claim against a newer post's text - a unit or an identity that fails there is a fact about
 * the wrong article, not about the claim. Claims without an id are new by definition.
 */
export function verifyNewClaims(
  drone: Drone,
  known: ReadonlySet<string>,
  text: string | undefined,
  catalog: readonly Drone[] = [],
  at = new Date().toISOString(),
): Drone {
  return verifyDrone(
    drone,
    () => text,
    catalog,
    at,
    (claim) => !claim.id || !known.has(claim.id),
  );
}
