import { ANALYST_SOURCE } from "./claim-review";
import type { ClaimVerification, Drone, SpecAttribute, SpecClaim } from "./types";
import { evidenceCheck } from "./verification-evidence";
import { identityCheck } from "./verification-identity";
import { boundsCheck, unitCheck } from "./verification-measure";
import { independentSourceCount } from "./verification-sources";
import { targetCheck, valueCheck, wordsCheck } from "./verification-wording";
import { VERIFIER_VERSION } from "./verification-check";

/**
 * Verify one claim. Undefined means there is nothing to verify: a hand-entered analyst claim is
 * already the highest authority and is deliberately left without a machine verdict.
 */

export function verifyClaim(input: {
  drone: Drone;
  spec: SpecAttribute;
  claim: SpecClaim;
  text?: string | undefined;
  catalog?: readonly Drone[];
  at?: string;
}): ClaimVerification | undefined {
  const { drone, spec, claim, text, catalog = [drone], at = new Date().toISOString() } = input;
  if (claim.source === ANALYST_SOURCE || claim.extractionEngine === "analyst") return undefined;

  const checks = [
    evidenceCheck(claim, text, at),
    unitCheck(spec, claim, at),
    boundsCheck(spec, claim, at),
    identityCheck(drone, claim, text, catalog, at),
    targetCheck(spec, claim, text, at),
    valueCheck(claim, at),
    wordsCheck(spec, claim, text, at),
  ];
  const applicable = checks.filter((c) => c.applicable);
  const failed = applicable.find((c) => c.verdict === "fail");
  const state = failed
    ? "rejected"
    : applicable.length > 0 && applicable.every((c) => c.verdict === "pass")
      ? "verified"
      : "uncertain";
  const confidence =
    state === "rejected"
      ? 0
      : state === "verified"
        ? Math.min(...applicable.map((c) => c.confidence ?? 0.5))
        : Math.min(
            0.5,
            ...applicable.filter((c) => c.verdict === "uncertain").map((c) => c.confidence ?? 0.3),
          );
  const coverage = applicable.length
    ? applicable.filter((c) => c.verdict !== "uncertain").length / applicable.length
    : 0;
  return {
    state,
    checks,
    confidence,
    coverage,
    independentSources: independentSourceCount(spec, claim),
    verifierVersion: VERIFIER_VERSION,
    at,
  };
}

/** Same verdict, ignoring when it was computed. Keeps a stable catalogue from being rewritten. */
export function sameVerification(
  a: ClaimVerification | undefined,
  b: ClaimVerification | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.state === b.state &&
    a.confidence === b.confidence &&
    a.coverage === b.coverage &&
    a.independentSources === b.independentSources &&
    a.verifierVersion === b.verifierVersion &&
    a.checks.length === b.checks.length &&
    a.checks.every((c, i) => {
      const d = b.checks[i];
      return (
        !!d &&
        c.kind === d.kind &&
        c.verdict === d.verdict &&
        c.applicable === d.applicable &&
        c.confidence === d.confidence &&
        c.detail === d.detail
      );
    })
  );
}
