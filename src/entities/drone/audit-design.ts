import {
  AUDIT_BUDGET,
  seededRandom,
  shuffle,
  type AuditCandidate,
  type AuditLanguage,
} from "./audit";
import {
  allocateProportional,
  errorPointEstimate,
  inclusionProbability,
  stratifiedUpperBound,
  type StratumSample,
} from "./audit-statistics";

/**
 * The formal evaluation: one frozen probability sample of the verified claims, and the single
 * analysis that says whether "verified" meets its error budget.
 *
 * Pure. Why a fixed design instead of looking at the answers as they come in: every look at a new
 * confidence bound is another chance for an unlucky sample to pass, so the risk of a wrong pass
 * would be larger than the 5 % the bound claims. Interim figures are shown, and never decide.
 */

/** Units with a valid reference answer (the first human reader's) that the formal sample is made of. */
export const FORMAL_SAMPLE_SIZE = 200;

/**
 * The strata of the formal sample, in the order they are drawn. Ukrainian and Russian posts share
 * one stratum. Why not four: the exact bound is taken over every way the wrong claims could be
 * spread across strata, and that search grows with the cube of the wrong claims for four strata
 * but with the square for three. Measured on this code: with four strata a catalogue of 14 500
 * verified claims and two wrong ones in the sample did not finish inside the allocation limit,
 * with three it takes about a second. Per-language tallies are still shown; they just do not
 * carry the gate.
 */
export const FORMAL_STRATA = ["en", "cyrillic", "other"] as const;

export const formalStratum = (language: AuditLanguage): (typeof FORMAL_STRATA)[number] =>
  language === "en" ? "en" : language === "uk" || language === "ru" ? "cyrillic" : "other";

export interface FormalDesign {
  /** N_h: verified claims with a post in each stratum (FORMAL_STRATA) at the moment of the draw. */
  populations: Record<string, number>;
  /** n_h: sampled units per stratum (proportional, at least one wherever N_h > 0). */
  allocation: Record<string, number>;
  size: number;
  seed: number;
  /** sha256 over the sorted (claim, stratum) list the draw was made from; set by the server. */
  populationFrameHash?: string;
  /** When the eligible claims were listed; set by the server. */
  eligibilityCutoff?: string;
}

/** One claim the design selected: the unit the statistics count, however often it is shown. */
export interface SampleUnit {
  claimId: string;
  stratum: string;
  /** pi_h = n_h / N_h: the same for every unit of a stratum, fixed at the draw. */
  inclusionProbability: number;
}

/**
 * Draw the formal sample: proportional by language stratum, the claims within a stratum chosen at
 * random from the recorded seed. Attribute family is deliberately not a stratum: with several
 * languages and every family the floor of five per cell alone would need more answers than the
 * sample has, and the diagnostic draw covers families instead (drawAuditSample).
 */
export function drawFormalSample(
  candidates: readonly AuditCandidate[],
  seed: number,
  size = FORMAL_SAMPLE_SIZE,
): { design: FormalDesign; units: SampleUnit[] } {
  const populations: Record<string, number> = {};
  const byStratum = new Map<string, AuditCandidate[]>();
  for (const stratum of FORMAL_STRATA) {
    const members = candidates.filter((c) => formalStratum(c.language) === stratum);
    if (!members.length) continue;
    populations[stratum] = members.length;
    byStratum.set(stratum, members);
  }
  const allocation = allocateProportional(populations, size);
  const units: SampleUnit[] = [];
  FORMAL_STRATA.forEach((stratum, index) => {
    const members = byStratum.get(stratum);
    const take = allocation[stratum] ?? 0;
    if (!members || !take) return;
    const chosen = shuffle(members, seededRandom(seed + index + 1)).slice(0, take);
    const pi = inclusionProbability(members.length, take);
    for (const c of chosen) units.push({ claimId: c.claimId, stratum, inclusionProbability: pi });
  });
  return { design: { populations, allocation, size, seed }, units };
}

/** One presentation of a sample unit to the person, with what the gate needs to know about it. */
export interface Presentation {
  sampleUnitId: string;
  stratum: string;
  answer: "yes" | "no" | "cannot_tell" | null;
  /** A failed control next to it voided the answer (voidedByControls). */
  voided: boolean;
  /** Draw order of this presentation; a later one supersedes an earlier one. */
  order: number;
}

export type UnitOutcome = "yes" | "no" | "cannot_tell";

/**
 * The one answer per sample unit that counts: the latest presentation that was answered and not
 * voided. A re-asked unit therefore never counts twice, and a unit whose only answers were voided
 * counts as not yet answered.
 */
export function finalAnswers(
  presentations: readonly Presentation[],
): Map<string, { stratum: string; outcome: UnitOutcome | null }> {
  const out = new Map<string, { stratum: string; outcome: UnitOutcome | null }>();
  for (const p of [...presentations].sort((a, b) => a.order - b.order)) {
    const keep = out.get(p.sampleUnitId);
    if (p.answer && !p.voided) out.set(p.sampleUnitId, { stratum: p.stratum, outcome: p.answer });
    else if (!keep) out.set(p.sampleUnitId, { stratum: p.stratum, outcome: null });
  }
  return out;
}

/**
 * The exact bound takes seconds on a large catalogue and the status is read after every answer,
 * so a result is kept per distinct sample: the same answers always give the same bound.
 */
const boundCache = new Map<string, ReturnType<typeof stratifiedUpperBound>>();
function cachedBound(samples: readonly StratumSample[]): ReturnType<typeof stratifiedUpperBound> {
  const key = JSON.stringify(samples);
  const hit = boundCache.get(key);
  if (hit) return hit;
  const result = stratifiedUpperBound(samples);
  if (boundCache.size > 50) boundCache.clear();
  boundCache.set(key, result);
  return result;
}

export interface FormalGate {
  /**
   * continue: units still wait for a valid answer. pass / not_proven: the single analysis, upper
   * bound within / above the budget. fail: a census whose own error share is above the budget.
   * incomplete: the exact bound could not be computed within its limit; never a pass.
   */
  decision: "pass" | "fail" | "continue" | "not_proven" | "incomplete";
  census: boolean;
  /** Units in the design. */
  units: number;
  /** Units with a valid final answer. */
  valid: number;
  /** Errors counted, "cannot tell" included as errors (worst case). */
  errors: number;
  cannotTell: number;
  /** Observed error share; the census figure when census is true. */
  pointEstimate?: number;
  /** Worst case upper 95 % bound: cannot-tell answers counted as errors. */
  upper?: number;
  /** Best case: cannot-tell answers left out of the sample. Absent when a stratum would empty. */
  bestCaseUpper?: number;
  strata: Array<{ name: string; population: number; sampled: number; errors: number }>;
}

/**
 * The single analysis over a formal design. "Cannot tell" counts as an error in the bound that
 * decides: dropping those answers from the denominator would let the claims hardest to judge
 * disappear from the evidence for "verified is right". The best case is shown beside it.
 */
export function formalGate(
  design: FormalDesign,
  finals: ReadonlyMap<string, { stratum: string; outcome: UnitOutcome | null }>,
  budget = AUDIT_BUDGET,
): FormalGate {
  const names = Object.keys(design.allocation).filter((n) => (design.allocation[n] ?? 0) > 0);
  const unitsTotal = names.reduce((s, n) => s + (design.allocation[n] ?? 0), 0);
  const tallies = new Map(names.map((n) => [n, { no: 0, ct: 0, yes: 0 }]));
  for (const { stratum, outcome } of finals.values()) {
    const t = tallies.get(stratum);
    if (!t || !outcome) continue;
    if (outcome === "no") t.no++;
    else if (outcome === "cannot_tell") t.ct++;
    else t.yes++;
  }
  const valid = [...tallies.values()].reduce((s, t) => s + t.no + t.ct + t.yes, 0);
  const strata = names.map((name) => {
    const t = tallies.get(name)!;
    return {
      name,
      population: design.populations[name] ?? 0,
      sampled: design.allocation[name] ?? 0,
      errors: t.no + t.ct,
    };
  });
  const errors = strata.reduce((s, x) => s + x.errors, 0);
  const cannotTell = [...tallies.values()].reduce((s, t) => s + t.ct, 0);
  const census = strata.length > 0 && strata.every((s) => s.sampled === s.population);
  const base = { census, units: unitsTotal, valid, errors, cannotTell, strata };
  if (!unitsTotal || valid < unitsTotal) return { decision: "continue", ...base };

  const samples: StratumSample[] = strata;
  const point = errorPointEstimate(samples);
  const worst = cachedBound(samples);
  // No claims at all, or a bound too close to call: neither is ever a pass.
  if (worst.kind === "no_population") return { ...base, decision: "incomplete" };
  if (worst.kind === "census")
    return {
      ...base,
      decision: point <= budget ? "pass" : "fail",
      pointEstimate: point,
      upper: point,
    };
  if (worst.kind === "incomplete") return { ...base, decision: "incomplete", pointEstimate: point };

  const bestSamples: StratumSample[] = names.map((name) => {
    const t = tallies.get(name)!;
    return {
      name,
      population: design.populations[name] ?? 0,
      sampled: t.no + t.yes,
      errors: t.no,
    };
  });
  const bestPossible = bestSamples.every((s) => s.sampled > 0);
  const best = bestPossible ? cachedBound(bestSamples) : undefined;
  return {
    ...base,
    decision: worst.upper <= budget ? "pass" : "not_proven",
    pointEstimate: point,
    upper: worst.upper,
    ...(best && (best.kind === "bound" || best.kind === "census")
      ? { bestCaseUpper: best.upper }
      : {}),
  };
}
