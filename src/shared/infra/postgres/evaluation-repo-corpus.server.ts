import type {
  AdjudicationStore,
  CorpusVersions,
  GitCorpusStore,
  HarvestStore,
} from "@/shared/contracts/evaluation-repo";
import { db } from "@/shared/infra/postgres/db.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import type { JSONValue } from "postgres";

export function createPostgresCorpusVersions(): CorpusVersions {
  return {
    async pinnedVersion() {
      const rows = await db()`select coalesce(max(version), 0) as v from eval_corpus_version`;
      return (rows[0]?.["v"] as number) ?? 0;
    },

    async recordVersion(version, note) {
      await db()`insert into eval_corpus_version (version, created_at, note) values (${version}, now(), ${note})`;
    },
  };
}

export function createPostgresGitCorpusStore(): GitCorpusStore {
  return {
    async gitFixtureExists(id) {
      const existing =
        await db()`select 1 from eval_corpus where id = ${id} and origin = 'git_import'`;
      return existing.length > 0;
    },

    async insertGitFixture({ id, kind, fixture }) {
      await db()`
        insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
        values (${id}, 1, ${kind}, ${db().json(sanitizeJson(fixture as unknown as JSONValue))}, 'approved', 'git_import', now())`;
    },
  };
}

export function createPostgresHarvestStore(): HarvestStore {
  return {
    async fixtureIdExists(id) {
      const exists = await db()`select 1 from eval_corpus where id = ${id}`;
      return exists.length > 0;
    },

    async insertHarvestedFixture({ id, version, fixture }) {
      await db()`
        insert into eval_corpus (id, version, kind, fixture, status, origin, source_report, observed_at)
        values (${id}, ${version}, 'positive', ${db().json(sanitizeJson(fixture as unknown as JSONValue))}, 'approved', 'agreement', null, now())`;
    },
  };
}

export function createPostgresAdjudicationStore(): AdjudicationStore {
  return {
    async adjudicatedIds() {
      return (await db()`select id from eval_corpus where id like 'adj-%'`).map(
        (r) => r["id"] as string,
      );
    },

    async insertAdjudicatedPositive({ id, fixture, status, decidedAt, decidedBy }) {
      await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at, decided_at, decided_by)
            values (${id}, 1, 'positive', ${db().json(sanitizeJson(fixture as unknown as JSONValue))}, ${status}, 'adjudication', now(), ${decidedAt}, ${decidedBy})
            on conflict (id, version) do nothing`;
    },

    async insertAdjudicatedNegative({ id, fixture }) {
      await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
            values (${id}, 1, 'negative', ${db().json(sanitizeJson(fixture as unknown as JSONValue))}, 'pending_fix', 'adjudication', now())
            on conflict (id, version) do nothing`;
    },

    async analystTally() {
      const rows = await db()`
    select status, count(*)::int as n from eval_corpus
    where origin = 'adjudication' and kind = 'positive' and decided_by = 'analyst'
      and status in ('approved', 'rejected')
    group by status`;
      return rows.map((r) => ({ status: r["status"] as string, n: r["n"] as number }));
    },

    async revokeAutonomousApprovals() {
      await db()`
    update eval_corpus set status = 'pending', decided_at = null, decided_by = null
    where origin = 'adjudication' and decided_by = 'autonomous' and status = 'approved'`;
    },
  };
}
