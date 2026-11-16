import type { CorpusFixtureRow, PendingFixtureStore } from "@/shared/contracts/evaluation-repo";
import { db } from "@/shared/infra/postgres/db.server";

function fixtureRow(r: Record<string, unknown>): CorpusFixtureRow {
  return {
    id: r["id"] as string,
    version: r["version"] as number,
    kind: r["kind"] as "positive" | "negative",
    origin: r["origin"] as string,
    observedAt: r["observed_at"] as Date,
    fixture: r["fixture"],
  };
}

export function createPostgresPendingFixtureStore(): PendingFixtureStore {
  return {
    async countPending() {
      const [{ n } = { n: 0 }] = (await db()`
    select count(*)::int as n from eval_corpus where status = 'pending'`) as unknown as {
        n: number;
      }[];
      return n;
    },

    async listPending(limit) {
      const rows = await db()`
    select id, version, kind, origin, observed_at, fixture from eval_corpus
    where status = 'pending' order by observed_at desc limit ${limit}`;
      return rows.map(fixtureRow);
    },

    async countAutoApproved() {
      const [{ ac } = { ac: 0 }] = (await db()`
    select count(*)::int as ac from eval_corpus
    where origin = 'adjudication' and decided_by = 'autonomous' and status = 'approved'`) as unknown as {
        ac: number;
      }[];
      return ac;
    },

    async listAutoApproved(limit) {
      const autoRows = await db()`
    select id, version, kind, origin, observed_at, fixture from eval_corpus
    where origin = 'adjudication' and decided_by = 'autonomous' and status = 'approved'
    order by decided_at desc limit ${limit}`;
      return autoRows.map(fixtureRow);
    },

    async decide(id, version, status) {
      const rows = await db()`
    update eval_corpus set status = ${status}, decided_at = now(), decided_by = 'analyst'
    where id = ${id} and version = ${version}
      and (status = 'pending' or (status = 'approved' and decided_by = 'autonomous'))
    returning id`;
      return rows.length > 0;
    },
  };
}
