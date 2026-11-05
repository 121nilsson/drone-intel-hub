import type { Norm, SpecComparison } from "./compare";

/**
 * How much of the reference a score was measured over is verified. Coverage is reported beside
 * every score, so a figure resting on unverified claims cannot pass for an audited one.
 */

/**
 * How much of the reference a score was measured over is actually verified (plan §4.4). An
 * unverified claim keeps the stored extraction as fallback, so the scores stay comparable while
 * the catalogue catches up; the ratio says how far that is evidence.
 */
export interface ReferenceCoverage {
  /** Claims the scores were measured over: every reference claim except the uncertain ones. */
  scored: number;
  /** Passed verification. */
  verified: number;
  /** Failed verification; scored as an expected negative. */
  rejected: number;
  /** Carried an analyst's verdict, which outranks verification. */
  analyst: number;
  /** No verifier or analyst verdict: scored against the stored extraction. */
  unverified: number;
  /** The AI dropped it at ingest and nobody has judged it since. */
  dropped: number;
  /** Verification could not decide; left out rather than counted as a miss. */
  uncertain: number;
  /** (verified + rejected + analyst) / scored; 0 when nothing was scored. */
  ratio: number;
}

/** The mutable counters behind a `ReferenceCoverage`, so callers can add one claim at a time. */
export type CoverageTally = Omit<ReferenceCoverage, "ratio">;

export const emptyCoverage = (): CoverageTally => ({
  scored: 0,
  verified: 0,
  rejected: 0,
  analyst: 0,
  unverified: 0,
  dropped: 0,
  uncertain: 0,
});

/** Count one reference claim. An analyst verdict outranks the verifier, which outranks ingest. */
export function addCoverage(t: CoverageTally, n: Norm): void {
  if (n.verdict) {
    t.scored++;
    t.analyst++;
    return;
  }
  if (n.verification === "uncertain") {
    t.uncertain++;
    return;
  }
  t.scored++;
  if (n.verification === "verified") t.verified++;
  else if (n.verification === "rejected") t.rejected++;
  else if (n.provenance === "heuristic") t.dropped++;
  else t.unverified++;
}

export function finishCoverage(t: CoverageTally): ReferenceCoverage {
  const decided = t.verified + t.rejected + t.analyst;
  return { ...t, ratio: t.scored ? decided / t.scored : 0 };
}

/** Coverage of a whole comparison: every reference claim is in exactly one bucket. */
export function comparisonCoverage(cmp: SpecComparison): ReferenceCoverage {
  const t = emptyCoverage();
  for (const p of cmp.pairs) addCoverage(t, p.r);
  for (const w of cmp.wrongKeys) addCoverage(t, w.r);
  for (const r of cmp.misses) addCoverage(t, r);
  for (const x of cmp.rejected) addCoverage(t, x.r);
  for (const x of cmp.excluded) addCoverage(t, x);
  return finishCoverage(t);
}

/** Coverage of a list of reference claims, before comparing anything to them. */
export function coverageOf(reference: readonly Norm[]): ReferenceCoverage {
  const t = emptyCoverage();
  for (const r of reference) addCoverage(t, r);
  return finishCoverage(t);
}

/** Add two finished coverages, e.g. a shadow run's running total and its latest batch. */
export function mergeCoverage(a: ReferenceCoverage, b: ReferenceCoverage): ReferenceCoverage {
  const t = emptyCoverage();
  for (const k of Object.keys(t) as (keyof CoverageTally)[]) t[k] = a[k] + b[k];
  return finishCoverage(t);
}
