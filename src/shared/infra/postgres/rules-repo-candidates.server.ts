import type { Candidate } from "@/entities/drone/types";
import type { RuleCandidatePool, StoredFixture } from "@/shared/contracts/rules-repo";
import { db } from "./db.server";

// Targeted candidate loads. The rule loop runs hourly and per click, so it never pulls the whole
// candidates collection: a rule can only change the output of a text containing one of its
// terms, and everything else it needs is a bounded, deterministic control sample.
/** Same eligibility as the sandbox's own filter, applied in SQL. Lazy fragment, nested below. */
const eligible = () => db()`status <> 'discarded' and length(coalesce(data->>'raw', '')) >= 50`;
const asCandidates = (rows: readonly { data: unknown }[]) => rows.map((r) => r.data as Candidate);
const likeEscape = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The candidates table as a pool for rule sandboxing, plus the evaluation corpus it is judged on. */
export function createPostgresRuleCandidatePool(): RuleCandidatePool {
  return {
    async candidatesMentioning(terms, limit) {
      const rows = await db()`
    select data from candidates where ${eligible()}
      and data->>'raw' ilike any(${terms.map(likeEscape)})
    order by created_at desc limit ${limit}`;
      return asCandidates(rows as unknown as { data: unknown }[]);
    },

    async candidateSample(n) {
      const rows = await db()`
    select data from candidates where ${eligible()} order by md5(id) limit ${n}`;
      return asCandidates(rows as unknown as { data: unknown }[]);
    },

    async candidatesSince(since, limit) {
      const rows = await db()`
    select data from candidates where ${eligible()} and created_at > ${since}
    order by created_at asc limit ${limit}`;
      return asCandidates(rows as unknown as { data: unknown }[]);
    },

    async candidatesBySource(sources, limit) {
      const list = [...sources];
      const rows =
        limit === undefined
          ? await db()`
    select data from candidates where data->>'source' = any(${list})
    order by created_at desc`
          : await db()`
    select data from candidates where data->>'source' = any(${list})
    order by created_at desc limit ${limit}`;
      return asCandidates(rows as unknown as { data: unknown }[]);
    },

    async analystResolvedCandidates(limit) {
      const rows = await db()`
    select data from candidates where ${eligible()}
      and status in ('promoted', 'merged') and data->>'resolvedBy' = 'analyst'
    order by created_at desc limit ${limit}`;
      return asCandidates(rows as unknown as { data: unknown }[]);
    },

    async corpusFixtures(): Promise<StoredFixture[]> {
      const rows = await db()`
    select distinct on (id) id, status, fixture from eval_corpus
    order by id, version desc`;
      return rows.map((r) => ({
        id: r["id"] as string,
        status: r["status"] as string,
        fixture: r["fixture"],
      }));
    },
  };
}
