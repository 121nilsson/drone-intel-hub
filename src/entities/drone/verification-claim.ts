import { ANALYST_SOURCE } from "./claim-review";
import type {
  ClaimVerification,
  Drone,
  SpecAttribute,
  SpecClaim,
  VerificationCheck,
} from "./types";
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
    boundsCheck(spec, claim, at, drone.flightProfile),
    identityCheck(drone, claim, text, catalog, at),
    targetCheck(spec, claim, text, at),
    valueCheck(claim, at),
    wordsCheck(spec, claim, text, at),
  ];
  return {
    ...conclude(checks),
    checks,
    independentSources: independentSourceCount(spec, claim),
    verifierVersion: VERIFIER_VERSION,
    at,
  };
}

/** What a set of checks adds up to: the state, how sure it is, and how much of it is settled. */
function conclude(checks: readonly VerificationCheck[]) {
  const applicable = checks.filter((c) => c.applicable);
  const failed = applicable.find((c) => c.verdict === "fail");
  const state: ClaimVerification["state"] = failed
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
  return { state, confidence, coverage };
}

/**
 * The stored verdict with only its bounds check redone, for when what counts as plausible changed
 * (the analyst set a flight profile). Every other check keeps what it found: they read the post,
 * which this has no need of, and re-running them without it would only lower the evidence check.
 * Undefined when the claim has no verdict yet or its bounds are unchanged.
 */
export function recheckBounds(
  drone: Drone,
  spec: SpecAttribute,
  claim: SpecClaim,
  at: string,
): ClaimVerification | undefined {
  const stored = claim.verification;
  if (!stored || claim.source === ANALYST_SOURCE || claim.extractionEngine === "analyst")
    return undefined;
  const fresh = boundsCheck(spec, claim, at, drone.flightProfile);
  const old = stored.checks.find((c) => c.kind === "bounds");
  if (old && old.verdict === fresh.verdict && old.applicable === fresh.applicable) return undefined;
  const checks = old
    ? stored.checks.map((c) => (c === old ? fresh : c))
    : [...stored.checks, fresh];
  return { ...stored, ...conclude(checks), checks, at };
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
