import { consensus } from "@/entities/drone/consensus";
import { attributeSemantic } from "@/entities/drone/spec-engine";
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
/** Below this the model's pick is not recorded, until analysts move the bar (checkTrust). */
export const CONTRADICTION_CONFIDENCE = 0.7;

/**
 * The check earns autonomy per spec family the same way generated rules do: from analysts. Where
 * reviewed claims agree with its verdicts at least TRUST_AGREEMENT of the time over at least
 * TRUST_MIN_REVIEWS, it may act on a less certain pick; where they disagree often, it must be
 * more certain. A family nobody has reviewed keeps the default bar.
 */
export const TRUST_MIN_REVIEWS = 20;
export const TRUST_AGREEMENT = 0.95;
export const EARNED_CONFIDENCE = 0.6;
export const DISTRUST_MIN_REVIEWS = 10;
export const DISTRUST_AGREEMENT = 0.7;
export const DISTRUSTED_CONFIDENCE = 0.9;

export interface CheckTrust {
  /** Reviewed claims whose verdict matched the check's: rejected outlier, confirmed supported. */
  agreed: number;
  disagreed: number;
  state: "earned" | "default" | "distrusted";
  /** The confidence a verdict in this family needs to be recorded. */
  bar: number;
}

/** "range.max" -> "range": the measurement family a trust record is kept for. */
export function specFamily(s: SpecAttribute): string {
  return attributeSemantic(s).split(".")[0]!;
}

function trustOf(agreed: number, disagreed: number): CheckTrust {
  const n = agreed + disagreed;
  const share = n ? agreed / n : 0;
  if (n >= TRUST_MIN_REVIEWS && share >= TRUST_AGREEMENT)
    return { agreed, disagreed, state: "earned", bar: EARNED_CONFIDENCE };
  if (n >= DISTRUST_MIN_REVIEWS && share < DISTRUST_AGREEMENT)
    return { agreed, disagreed, state: "distrusted", bar: DISTRUSTED_CONFIDENCE };
  return { agreed, disagreed, state: "default", bar: CONTRADICTION_CONFIDENCE };
}

/** How often analysts agreed with the check, per spec family, from the claims both judged. */
export function checkTrust(drones: readonly Drone[]): Map<string, CheckTrust> {
  const tally = new Map<string, { agreed: number; disagreed: number }>();
  for (const d of drones)
    for (const s of d.specs)
      for (const c of s.claims) {
        if (!c.review || !c.adjudication) continue;
        const t = tally.get(specFamily(s)) ?? { agreed: 0, disagreed: 0 };
        const checkSaysWrong = c.adjudication.verdict === "outlier";
        const analystSaysWrong = c.review.verdict === "rejected";
        if (checkSaysWrong === analystSaysWrong) t.agreed++;
        else t.disagreed++;
        tally.set(specFamily(s), t);
      }
  return new Map([...tally].map(([family, t]) => [family, trustOf(t.agreed, t.disagreed)]));
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
          .map((c) => ({
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
