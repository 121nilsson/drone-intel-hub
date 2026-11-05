import type { ReferenceCoverage } from "./coverage";
import type { MatchType } from "./compare";

/**
 * Shapes the evaluation reports, fixtures and options are read and written in. No logic here, so
 * the store, the UI and the tests can import them without pulling in the scoring code.
 */

export interface EvalMismatch {
  candidateId: string;
  source: string;
  text: string;
  specKey: string;
  matchType: MatchType;
  heuristicValue: string | number | null;
  heuristicUnit: string | null;
  referenceValue: string | number | null;
  referenceUnit: string | null;
  evidence: string;
  normalizedHeuristic?: { canonicalValue?: number | undefined; canonicalUnit?: string | undefined };
  normalizedReference?: { canonicalValue?: number | undefined; canonicalUnit?: string | undefined };
}

export interface Prf {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface EvalReport {
  generatedAt: string;
  sampleSize: number;
  totalItems: number;
  stratification: {
    platform: Record<string, number>;
    outcome: Record<string, number>;
    epoch: Record<string, number>;
  };
  summary: Prf;
  identity: { name: Prf; matchId: Prf };
  perKey: Record<string, Prf>;
  /** Reference coverage overall, reported beside every score (plan §4.4). */
  reference: ReferenceCoverage;
  /** Reference coverage per spec key, so a key's F1 is never read without it. */
  perKeyReference: Record<string, ReferenceCoverage>;
  mismatches: EvalMismatch[];
  topIssues: string[];
  /** Agreements usable as regression fixtures. */
  fixtures: EvalFixture[];
  /** Reference figures with no canonical meaning, left out of the scores (see `scorable`). */
  unscoredMisses?: number;
}

export interface EvalFixture {
  id: string;
  source: string;
  text: string;
  /** Semantic key + canonical value the heuristic must keep producing. */
  expect: { semantic: string; value: number | string; unit?: string }[];
  /** Specs that must NOT be produced (known bad outputs). */
  forbid?: { semantic: string; value?: number | string; unit?: string }[];
  expectNames?: string[];
  /** Lifecycle status for fixtures. */
  status?: "approved" | "pending" | "pending_fix";
}

export interface EvalOptions {
  sampleSize?: number;
  seed?: number;
  includeDiscarded?: boolean;
  minRawLength?: number;
  maxMismatchesPerKey?: number;
  onProgress?: (done: number, total: number) => void;
}

export const MIN_RAW = 50;
