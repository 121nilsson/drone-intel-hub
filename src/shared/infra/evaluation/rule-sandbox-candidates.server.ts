import { analystVerdicts, verifiedVerdicts } from "@/shared/infra/evaluation/evaluation";
import { rulesRepo } from "@/shared/infra/evaluation/rule-sandbox-store.server";
import type { Candidate, Drone } from "@/entities/drone/types";

// Targeted candidate loads. The rule loop runs hourly and per click, so it never pulls the whole
// candidates collection: a rule can only change the output of a text containing one of its
// terms, and everything else it needs is a bounded, deterministic control sample. The queries
// live in the rules repository; what to ask for is decided here.
/** Unrelated candidates the sandbox stratifies its control set from. */
export const CONTROL_POOL = 200;

/** Newest eligible candidates whose text contains any of the terms (case-insensitive). */
export async function candidatesMentioning(terms: readonly string[], limit = 300) {
  if (!terms.length) return [];
  return rulesRepo().candidatesMentioning(terms, limit);
}

/** Deterministic pseudo-random sample: same rows on every call while the table is unchanged. */
export async function candidateSample(n: number) {
  return rulesRepo().candidateSample(n);
}

/** Eligible candidates created after a watermark, oldest first. */
export async function candidatesSince(since: string, limit: number) {
  return rulesRepo().candidatesSince(since, limit);
}

/**
 * The candidates behind the claims an analyst has ruled on, found by the claim's source line.
 * Bounded by the number of verdicts, not by the size of the collection.
 */
export async function reviewedCandidates(drones: readonly Drone[]) {
  const sources = [...analystVerdicts(drones).keys()];
  if (!sources.length) return [];
  return rulesRepo().candidatesBySource(sources);
}

/**
 * The candidates behind any claim the verifier or an analyst has judged (verifiedFixtures),
 * newest first. Capped: the sandbox replays every fixture twice (baseline and proposed), so an
 * uncapped catalogue-wide fixture set would make each activation slower than the decision it
 * serves. The cap keeps the newest reports, which is where a rule's terms actually appear.
 */
export async function judgedCandidates(drones: readonly Drone[], limit = 2000) {
  const sources = [...verifiedVerdicts(drones).keys()];
  if (!sources.length) return [];
  return rulesRepo().candidatesBySource(sources, limit);
}

/** Candidates an analyst promoted or merged from the Queue, newest first (queueFixtures). */
export async function analystResolvedCandidates(limit = 2000) {
  return rulesRepo().analystResolvedCandidates(limit);
}

export const mergeById = (...lists: Candidate[][]) => [
  ...new Map(lists.flat().map((c) => [c.id, c])).values(),
];
