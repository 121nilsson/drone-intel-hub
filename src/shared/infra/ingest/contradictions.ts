import { consensus, rawPoint } from "@/entities/drone/consensus";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import type { Drone, SpecAttribute } from "@/entities/drone/types";
import { ProviderOutageError, type ContradictionAdjudicator } from "@/shared/contracts/ai";
import type { DroneRepository } from "@/shared/contracts/repository";
import { tallyBy, trustState, type TrustState } from "./earned-trust";

export {
  DISTRUST_AGREEMENT,
  DISTRUST_MIN_REVIEWS,
  TRUST_AGREEMENT,
  TRUST_MIN_REVIEWS,
} from "./earned-trust";

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
/** Below this the model's pick is not recorded, until analysts move the bar (checkTrust). */
export const CONTRADICTION_CONFIDENCE = 0.7;

/**
 * The check earns autonomy per spec family from analysts (earned-trust.ts): where reviewed claims
 * agree with its verdicts, it may act on a less certain pick; where they disagree often, it must
 * be more certain. A family nobody has reviewed keeps the default bar.
 */
export const EARNED_CONFIDENCE = 0.6;
export const DISTRUSTED_CONFIDENCE = 0.9;
const BAR: Record<TrustState, number> = {
  earned: EARNED_CONFIDENCE,
  default: CONTRADICTION_CONFIDENCE,
  distrusted: DISTRUSTED_CONFIDENCE,
};

export interface CheckTrust {
  /** Reviewed claims whose verdict matched the check's: rejected outlier, confirmed supported. */
  agreed: number;
  disagreed: number;
  state: TrustState;
  /** The confidence a verdict in this family needs to be recorded. */
  bar: number;
}

/** "range.max" -> "range": the measurement family a trust record is kept for. */
export function specFamily(s: SpecAttribute): string {
  return attributeSemantic(s).split(".")[0]!;
}

/** How often analysts agreed with the check, per spec family, from the claims both judged. */
export function checkTrust(drones: readonly Drone[]): Map<string, CheckTrust> {
  const judged = drones.flatMap((d) => d.specs.flatMap((s) => s.claims.map((c) => ({ s, c }))));
  const tally = tallyBy(judged, ({ s, c }) =>
    c.review && c.adjudication
      ? {
          category: specFamily(s),
          agreed: (c.adjudication.verdict === "outlier") === (c.review.verdict === "rejected"),
        }
      : null,
  );
  return new Map(
    [...tally].map(([family, t]) => {
      const state = trustState(t);
      return [family, { ...t, state, bar: BAR[state] }];
    }),
  );
}

/** The confidence a verdict on this spec needs, given the family's record. */
export function confidenceBar(s: SpecAttribute, trust: ReadonlyMap<string, CheckTrust>): number {
  return trust.get(specFamily(s))?.bar ?? CONTRADICTION_CONFIDENCE;
}

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
  const all = drones.list();
  const trust = checkTrust(all);
  const queue = all.flatMap((d) => disputedSpecs(d).map((spec) => ({ drone: d, spec })));
  for (const { drone, spec } of queue.slice(0, max)) {
    // A claim an analyst rejected is settled. Offering it as a candidate would let the check
    // back a figure a person has already ruled out, so it is left out of the question and its
    // record is left as it is.
    const asked = spec.claims.flatMap((c, i) => (c.review?.verdict === "rejected" ? [] : [i]));
    let verdict;
    try {
      verdict = await opts.adjudicate({
        drone,
        specLabel: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
        // The order of `asked` is the index space the verdict answers in.
        claims: asked
          .map((i) => spec.claims[i]!)
          .map((c) => {
            // The figure as a number, when the claim can be read as one. The model is asked
            // which report is best supported, so it has to see the numbers: "0.8 Mach",
            // "Mach 0.8" and "0.8 Маха" are one figure, and read as three strings they
            // look like a disagreement that is not there.
            const point = rawPoint(spec, c);
            return {
              value: String(c.value),
              ...(point ? { normalizedValue: point.value } : {}),
              ...(point?.unit ? { normalizedUnit: point.unit } : {}),
              source: c.source,
              ...(c.evidence ? { evidence: c.evidence } : {}),
            };
          }),
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
      verdict.confidence >= confidenceBar(spec, trust) &&
      verdict.supported >= 0 &&
      verdict.supported < asked.length;
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
    const supported = asked[verdict.supported];
    const claims = spec.claims.map((c, i) =>
      asked.includes(i)
        ? {
            ...c,
            adjudication: {
              verdict: i === supported ? ("supported" as const) : ("outlier" as const),
              confidence: verdict.confidence,
              at,
              ...(i === supported && verdict.reason ? { reason: verdict.reason } : {}),
            },
          }
        : c,
    );
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
