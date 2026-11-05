import { db } from "@/shared/infra/postgres/db.server";
import { analystVerdicts, verifiedVerdicts } from "@/shared/infra/evaluation/evaluation";
import type { Candidate, Drone } from "@/entities/drone/types";

// Targeted candidate loads. The rule loop runs hourly and per click, so it never pulls the whole
// candidates collection: a rule can only change the output of a text containing one of its
// terms, and everything else it needs is a bounded, deterministic control sample.
/** Same eligibility as the sandbox's own filter, applied in SQL. Lazy fragment, nested below. */
export const eligible = () =>
  db()`status <> 'discarded' and length(coalesce(data->>'raw', '')) >= 50`;
/** Unrelated candidates the sandbox stratifies its control set from. */
export const CONTROL_POOL = 200;
export const asCandidates = (rows: readonly { data: unknown }[]) =>
  rows.map((r) => r.data as Candidate);
export const likeEscape = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Newest eligible candidates whose text contains any of the terms (case-insensitive). */
export async function candidatesMentioning(terms: readonly string[], limit = 300) {
  if (!terms.length) return [];
  const rows = await db()`
    select data from candidates where ${eligible()}
      and data->>'raw' ilike any(${terms.map(likeEscape)})
    order by created_at desc limit ${limit}`;
  return asCandidates(rows as unknown as { data: unknown }[]);
}

/** Deterministic pseudo-random sample: same rows on every call while the table is unchanged. */
export async function candidateSample(n: number) {
  const rows = await db()`
    select data from candidates where ${eligible()} order by md5(id) limit ${n}`;
  return asCandidates(rows as unknown as { data: unknown }[]);
}

/** Eligible candidates created after a watermark, oldest first. */
export async function candidatesSince(since: string, limit: number) {
  const rows = await db()`
    select data from candidates where ${eligible()} and created_at > ${since}
    order by created_at asc limit ${limit}`;
  return asCandidates(rows as unknown as { data: unknown }[]);
}

/**
 * The candidates behind the claims an analyst has ruled on, found by the claim's source line.
 * Bounded by the number of verdicts, not by the size of the collection.
 */
export async function reviewedCandidates(drones: readonly Drone[]) {
  const sources = [...analystVerdicts(drones).keys()];
  if (!sources.length) return [];
  const rows = await db()`
    select data from candidates where data->>'source' = any(${sources})
    order by created_at desc`;
  return asCandidates(rows as unknown as { data: unknown }[]);
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
  const rows = await db()`
    select data from candidates where data->>'source' = any(${sources})
    order by created_at desc limit ${limit}`;
  return asCandidates(rows as unknown as { data: unknown }[]);
}

/** Candidates an analyst promoted or merged from the Queue, newest first (queueFixtures). */
export async function analystResolvedCandidates(limit = 2000) {
  const rows = await db()`
    select data from candidates where ${eligible()}
      and status in ('promoted', 'merged') and data->>'resolvedBy' = 'analyst'
    order by created_at desc limit ${limit}`;
  return asCandidates(rows as unknown as { data: unknown }[]);
}

export const mergeById = (...lists: Candidate[][]) => [
  ...new Map(lists.flat().map((c) => [c.id, c])).values(),
];
