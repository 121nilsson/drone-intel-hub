import { consensus } from "@/entities/drone/consensus";
import type { Drone, SpecAttribute } from "@/entities/drone/types";
import { ProviderOutageError, type ContradictionAdjudicator } from "@/shared/contracts/ai";
import type { DroneRepository } from "@/shared/contracts/repository";

/**
 * Contested figures, settled by the deep model instead of a reader. consensus() already flags a
 * spec as disputed when its sources materially disagree; this asks, once per disputed spec,
 * which of the reports behind the disagreement is best supported - and records the answer on
 * the claims themselves.
 *
 * A verdict never deletes or rewrites a claim: the report said what it said, and provenance
 * stays whole. The "supported" claim is marked as the one the check backed, the others as
 * outliers, so a reader sees the disagreement has been adjudicated rather than hidden. When the
 * model cannot tell the reports apart, no claim is marked - an unresolved disagreement is the
 * honest outcome, not a coin flip.
 */

/** Specs checked per run, so this cannot eat the triage budget. */
export const MAX_CONTRADICTION_CHECKS = 10;
/** Below this the model's pick is not recorded. */
export const CONTRADICTION_CONFIDENCE = 0.7;

export interface ContradictionReport {
  /** Specs the check actually asked about. */
  checked: number;
  /** Claims marked as an outlier. */
  outliers: number;
  /** Why the check stopped early, when it did. */
  stopReason?: string;
}

/**
 * A disputed spec needs a check when it has never had one, or when a claim arrived since the
 * last one - which keeps the question one-shot per disagreement while re-opening it when new
 * reporting joins a settled fight.
 */
export function needsCheck(s: SpecAttribute): boolean {
  if (s.claims.length < 2 || !consensus(s).disputed) return false;
  const checkedAt = s.contradictionCheckedAt ? Date.parse(s.contradictionCheckedAt) : Number.NaN;
  if (!Number.isFinite(checkedAt)) return true;
  return s.claims.some((c) => Date.parse(c.date) > checkedAt);
}

export function disputedSpecs(d: Drone): SpecAttribute[] {
  return d.specs.filter(needsCheck);
}

export async function adjudicateContradictions(
  drones: DroneRepository,
  opts: { adjudicate?: ContradictionAdjudicator; max?: number; now?: number } = {},
): Promise<ContradictionReport> {
  const rep: ContradictionReport = { checked: 0, outliers: 0 };
  if (!opts.adjudicate) return rep;
  const now = opts.now ?? Date.now();
  const max = opts.max ?? MAX_CONTRADICTION_CHECKS;
  const queue = drones.list().flatMap((d) => disputedSpecs(d).map((spec) => ({ drone: d, spec })));
  for (const { drone, spec } of queue.slice(0, max)) {
    let verdict;
    try {
      verdict = await opts.adjudicate({
        drone,
        specLabel: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
        // Claim order is the index space the verdict answers in.
        claims: spec.claims.map((c) => ({
          value: String(c.value),
          source: c.source,
          ...(c.evidence ? { evidence: c.evidence } : {}),
        })),
      });
    } catch (e) {
      // An outage would fail every remaining call too; anything else is this one spec.
      if (e instanceof ProviderOutageError) {
        rep.stopReason = e.message;
        break;
      }
      continue;
    }
    rep.checked++;
    const at = new Date(now).toISOString();
    const decided =
      verdict.confidence >= CONTRADICTION_CONFIDENCE &&
      verdict.supported >= 0 &&
      verdict.supported < spec.claims.length;
    if (!decided) {
      // Asked, not answered: the one-shot marker still applies, so an undecidable disagreement
      // is not re-asked on every run.
      drones.upsert({
        ...drone,
        specs: drone.specs.map((s) => (s === spec ? { ...s, contradictionCheckedAt: at } : s)),
        updatedAt: at,
      });
      continue;
    }
    const claims = spec.claims.map((c, i) => ({
      ...c,
      adjudication: {
        verdict: i === verdict.supported ? ("supported" as const) : ("outlier" as const),
        confidence: verdict.confidence,
        at,
        ...(i === verdict.supported && verdict.reason ? { reason: verdict.reason } : {}),
      },
    }));
    rep.outliers += claims.filter((c) => c.adjudication?.verdict === "outlier").length;
    drones.upsert({
      ...drone,
      specs: drone.specs.map((s) =>
        s === spec ? { ...s, claims, contradictionCheckedAt: at } : s,
      ),
      updatedAt: at,
    });
  }
  return rep;
}
