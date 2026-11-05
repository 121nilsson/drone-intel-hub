import { ANALYST_SOURCE } from "./claim-review";
import type { Drone, SpecClaim } from "./types";

export interface VerificationCoverage {
  total: number;
  /** Analyst-entered claims, which carry no machine verdict by design. */
  analyst: number;
  unverified: number;
  verified: number;
  uncertain: number;
  rejected: number;
  /** Non-analyst claims carrying any verification record, over non-analyst claims. */
  checked: number;
}

/** Coverage across the catalogue, for the Autonomy page. */
export function verificationCoverage(
  drones: readonly Drone[],
  isAnalyst: (claim: SpecClaim) => boolean = (c) =>
    c.source === ANALYST_SOURCE || c.extractionEngine === "analyst",
): VerificationCoverage {
  const out: VerificationCoverage = {
    total: 0,
    analyst: 0,
    unverified: 0,
    verified: 0,
    uncertain: 0,
    rejected: 0,
    checked: 0,
  };
  for (const drone of drones)
    for (const spec of drone.specs)
      for (const claim of spec.claims) {
        out.total++;
        if (isAnalyst(claim)) {
          out.analyst++;
          continue;
        }
        if (!claim.verification) {
          out.unverified++;
          continue;
        }
        out.checked++;
        out[claim.verification.state]++;
      }
  return out;
}

/** Claims a reader should look at first: rejected, then uncertain. */
export function verificationExceptions(drones: readonly Drone[]) {
  return drones.flatMap((drone) =>
    drone.specs.flatMap((spec) =>
      spec.claims.flatMap((claim) => {
        const v = claim.verification;
        if (!v || v.state === "verified") return [];
        return [
          {
            droneId: drone.id,
            droneName: drone.name,
            specKey: spec.key,
            specLabel: spec.label,
            claim,
            verification: v,
            /** The failed or uncertain check that matters most. */
            check:
              v.checks.find((c) => c.verdict === "fail") ??
              v.checks.find((c) => c.verdict === "uncertain" && c.applicable),
          },
        ];
      }),
    ),
  );
}
