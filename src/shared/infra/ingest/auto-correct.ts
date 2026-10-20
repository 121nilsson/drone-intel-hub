import { correctionKey, detectCorrection, sameFinding } from "@/entities/drone/auto-correction";
import type { AutoCorrection, ClaimReview, Drone, SpecClaim } from "@/entities/drone/types";
import type { DroneRepository } from "@/shared/contracts/repository";
import { tallyBy, trustState, type TrustState, type TrustTally } from "./earned-trust";

/**
 * Runs the deterministic corrector (entities/drone/auto-correction.ts) over the catalog after
 * each sync. Free - no model is asked - so it covers every claim on every run, and it runs before
 * the contradiction check: a unit slip it settles is no longer a dispute to spend a call on.
 *
 * A finding is applied only for a kind of correction analysts have earned it for
 * (earned-trust.ts), and that is recomputed here every run: a kind whose agreement drops is
 * un-applied everywhere on the next run, which is the rollback. A claim an analyst has ruled on
 * is left exactly as it is, because the finding on it is what that agreement is measured on.
 */

export interface CorrectionTrust extends TrustTally {
  state: TrustState;
}

/**
 * Whether the analyst reached the corrector's verdict. Rejecting the figure agrees, except that a
 * unit fix on a figure about another system would have applied a wrong value.
 */
function agrees(fix: AutoCorrection, review: ClaimReview): boolean {
  if (review.verdict === "confirmed") return false;
  return fix.kind === "implausible" || review.issue !== "system";
}

/** Analyst agreement per kind of correction (correctionKey), from claims both have judged. */
export function correctionTrust(drones: readonly Drone[]): Map<string, CorrectionTrust> {
  const claims = drones.flatMap((d) => d.specs.flatMap((s) => s.claims));
  const tally = tallyBy(claims, (c) =>
    c.review && c.autoCorrection
      ? { category: correctionKey(c.autoCorrection), agreed: agrees(c.autoCorrection, c.review) }
      : null,
  );
  return new Map([...tally].map(([k, t]) => [k, { ...t, state: trustState(t) }]));
}

export interface AutoCorrectReport {
  /** New findings. */
  proposed: number;
  /** Findings consensus now uses that it did not before. */
  applied: number;
  /** Findings gone, or no longer applied. */
  withdrawn: number;
}

function without(c: SpecClaim): SpecClaim {
  const next = { ...c };
  delete next.autoCorrection;
  return next;
}

export function autoCorrect(
  drones: DroneRepository,
  opts: { now?: number; apply?: boolean } = {},
): AutoCorrectReport {
  const rep: AutoCorrectReport = { proposed: 0, applied: 0, withdrawn: 0 };
  const at = new Date(opts.now ?? Date.now()).toISOString();
  const all = drones.list();
  const trust = correctionTrust(all);
  for (const drone of all) {
    let changed = false;
    const specs = drone.specs.map((s) => {
      let specChanged = false;
      const claims = s.claims.map((c, i) => {
        if (c.review) return c;
        const prev = c.autoCorrection;
        const found = detectCorrection(s, i, at);
        if (!found) {
          if (!prev) return c;
          specChanged = true;
          rep.withdrawn++;
          return without(c);
        }
        const applied = opts.apply !== false && trust.get(correctionKey(found))?.state === "earned";
        const same = sameFinding(prev, found);
        if (same && prev!.applied === applied) return c;
        specChanged = true;
        if (!same) rep.proposed++;
        if (applied && !(same && prev!.applied)) rep.applied++;
        if (!applied && same && prev!.applied) rep.withdrawn++;
        return { ...c, autoCorrection: { ...found, applied, at: same ? prev!.at : at } };
      });
      if (!specChanged) return s;
      changed = true;
      return { ...s, claims };
    });
    if (changed) drones.upsert({ ...drone, specs, updatedAt: at });
  }
  return rep;
}
