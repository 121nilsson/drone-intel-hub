import type {
  ExtractedSpec,
  Extraction,
  SpecProvenance,
  VerificationState,
} from "@/entities/drone/types";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { isFinancialSpec } from "@/entities/procurement/routing";
import { isActivitySpec } from "@/entities/drone/activity";

/**
 * Turns specs into comparable values and pairs a heuristic's claims with the reference's. Pure:
 * every decision here reads the claims it is given and nothing else.
 */

export type MatchType =
  | "exact"
  | "semantic"
  | "raw"
  | "differentReading"
  | "wrongKey"
  | "falsePositive"
  | "miss"
  /** The heuristic still makes a claim the AI was shown and dropped (provenance "heuristic"). */
  | "rejected";

export function numbersClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01 * Math.max(Math.abs(a), Math.abs(b)), 1e-6);
}

export interface Norm {
  semantic: string;
  key: string;
  value: number | string;
  unit?: string | undefined;
  canonical?: number | undefined;
  canonicalUnit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  evidence: string;
  provenance?: SpecProvenance | undefined;
  /** An analyst's verdict on the catalog claim this spec became (verifiedReference). */
  verdict?: "confirmed" | "rejected" | undefined;
  /** The verifier's conclusion on that claim. An analyst verdict outranks it (verifiedReference). */
  verification?: VerificationState | undefined;
}

function norm(s: ExtractedSpec): Norm {
  const semantic = semanticKeyFor(s.key, s.label);
  // Prices compare on amount: the heuristic stores a number, an AI often the written string
  // ("$2 billion", parsed into money.amount). Currency is left out because the heuristic does
  // not keep it, and the same text rarely states one amount in two currencies.
  if (semantic === "cost.unit") {
    const amount = typeof s.value === "number" ? s.value : s.money?.amount;
    if (amount !== undefined)
      return {
        semantic,
        key: s.key,
        value: s.value,
        unit: s.unit,
        canonical: amount,
        canonicalUnit: undefined,
        evidence: s.evidence ?? s.raw ?? "",
        provenance: s.provenance,
      };
  }
  const n = s.normalized;
  return {
    semantic,
    key: s.key,
    value: s.value,
    unit: s.unit,
    canonical: n?.canonicalValue ?? (typeof s.value === "number" ? s.value : undefined),
    canonicalUnit: n?.canonicalUnit ?? s.unit,
    min: n?.range?.min,
    max: n?.range?.max,
    evidence: s.evidence ?? s.raw ?? "",
    provenance: s.provenance,
  };
}

function sameValue(a: Norm, b: Norm): "exact" | "differentReading" | "raw" | null {
  if (a.canonical !== undefined && b.canonical !== undefined) {
    if (
      numbersClose(a.canonical, b.canonical) &&
      (a.canonicalUnit ?? "") === (b.canonicalUnit ?? "")
    )
      return "exact";
  }
  const aBound = a.max ?? a.min;
  const bBound = b.max ?? b.min;
  const aPoint = a.canonical ?? aBound;
  const bPoint = b.canonical ?? bBound;
  if (
    (a.max !== undefined || b.max !== undefined || a.min !== undefined || b.min !== undefined) &&
    aPoint !== undefined &&
    bPoint !== undefined &&
    numbersClose(aPoint, bPoint)
  )
    return "differentReading";
  if (
    String(a.value).trim().toLowerCase() === String(b.value).trim().toLowerCase() &&
    (a.unit ?? "") === (b.unit ?? "")
  )
    return "raw";
  return null;
}

/**
 * Whether a reference claim is known to be wrong. An analyst's verdict outranks the verifier in
 * both directions, the same order claimCounts() applies to the catalog.
 */
export const isDropped = (r: Norm) =>
  r.verdict
    ? r.verdict === "rejected"
    : r.verification
      ? r.verification === "rejected"
      : r.provenance === "heuristic";

/** A claim the verifier could not decide: it is left out of the scores, never counted as a miss. */
export const isExcluded = (r: Norm) => !r.verdict && r.verification === "uncertain";

/** Usable specs only: financial/procurement keys are routed out of drone specs, so ignore them. */
export function comparableSpecs(e: Extraction): Norm[] {
  // Deal figures and activity figures leave the specs at merge; they are not scored as specs.
  return e.specs.filter((s) => !isFinancialSpec(s) && !isActivitySpec(s)).map(norm);
}

export interface SpecComparison {
  pairs: { h: Norm; r: Norm; type: MatchType }[];
  falsePositives: Norm[];
  misses: Norm[];
  wrongKeys: { h: Norm; r: Norm }[];
  /** Heuristic claims matching a reference claim the AI dropped: false positives with proof. */
  rejected: { h: Norm; r: Norm }[];
  /** Reference claims the verifier could not decide: left out of every score, not counted as misses. */
  excluded: Norm[];
}

/**
 * Greedy one-to-one pairing: same semantic first, then same value under another key.
 *
 * The stored extraction keeps every heuristic claim, so pairing against it as-is would score the
 * heuristic against its own ingest-time output. Claims the AI dropped (provenance "heuristic")
 * or the verifier rejected are therefore never a match: a heuristic claim equal to one is
 * `rejected`, and one the heuristic no longer makes is not a miss. A claim the verifier could not
 * decide is not scored at all - neither its absence (a miss) nor a heuristic claim matching it (a
 * false positive). Candidates stored before provenance behave as before.
 */
export function compareSpecs(heur: Norm[], allRef: Norm[]): SpecComparison {
  const excluded = allRef.filter(isExcluded);
  const ref = allRef.filter((r) => !isExcluded(r) && !isDropped(r));
  const dropped = allRef.filter((r) => !isExcluded(r) && isDropped(r));
  const usedR = new Set<number>();
  const usedH = new Set<number>();
  const pairs: SpecComparison["pairs"] = [];
  const wrongKeys: SpecComparison["wrongKeys"] = [];
  heur.forEach((h, hi) => {
    const ri = ref.findIndex(
      (r, i) => !usedR.has(i) && r.semantic === h.semantic && sameValue(h, r),
    );
    const r = ref[ri];
    if (ri < 0 || !r) return;
    const t = sameValue(h, r)!;
    pairs.push({ h, r, type: t === "exact" ? (h.key === r.key ? "exact" : "semantic") : t });
    usedR.add(ri);
    usedH.add(hi);
  });
  heur.forEach((h, hi) => {
    if (usedH.has(hi)) return;
    const ri = ref.findIndex(
      (r, i) => !usedR.has(i) && r.semantic !== h.semantic && sameValue(h, r) === "exact",
    );
    const r = ref[ri];
    if (ri < 0 || !r) return;
    wrongKeys.push({ h, r });
    usedR.add(ri);
    usedH.add(hi);
  });
  const rejected: SpecComparison["rejected"] = [];
  const falsePositives: Norm[] = [];
  heur.forEach((h, hi) => {
    if (usedH.has(hi)) return;
    // A claim the verifier could not decide is not evidence against the heuristic either.
    if (excluded.some((x) => x.semantic === h.semantic && sameValue(h, x))) return;
    const r = dropped.find((d) => d.semantic === h.semantic && sameValue(h, d));
    if (r) rejected.push({ h, r });
    else falsePositives.push(h);
  });
  return {
    pairs,
    wrongKeys,
    falsePositives,
    misses: ref.filter((_, i) => !usedR.has(i)),
    rejected,
    excluded,
  };
}
