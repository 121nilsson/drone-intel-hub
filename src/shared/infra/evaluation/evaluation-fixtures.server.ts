import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import type { EvalFixture } from "@/shared/infra/evaluation/evaluation";
import type { TrustState, TrustTally } from "@/shared/infra/ingest/earned-trust";
import { adjudicationTrust } from "@/shared/infra/evaluation/evaluation-adjudication.server";

export interface PendingFixture {
  id: string;
  version: number;
  kind: "positive" | "negative";
  origin: string;
  observedAt: string;
  fixture: EvalFixture;
}

/** Fixtures waiting for an analyst, newest first. The sandbox does not use them until approved. */
export async function listPendingFixtures(limit = 25): Promise<{
  total: number;
  items: PendingFixture[];
  trust: TrustTally & { state: TrustState };
  autoApproved: number;
  autoApprovedRecent: PendingFixture[];
}> {
  const trust = await adjudicationTrust();
  if (!dbConfigured())
    return { total: 0, items: [], trust, autoApproved: 0, autoApprovedRecent: [] };
  const [{ n } = { n: 0 }] = (await db()`
    select count(*)::int as n from eval_corpus where status = 'pending'`) as unknown as {
    n: number;
  }[];
  const rows = await db()`
    select id, version, kind, origin, observed_at, fixture from eval_corpus
    where status = 'pending' order by observed_at desc limit ${limit}`;
  const [{ ac } = { ac: 0 }] = (await db()`
    select count(*)::int as ac from eval_corpus
    where origin = 'adjudication' and decided_by = 'autonomous' and status = 'approved'`) as unknown as {
    ac: number;
  }[];
  const autoRows = await db()`
    select id, version, kind, origin, observed_at, fixture from eval_corpus
    where origin = 'adjudication' and decided_by = 'autonomous' and status = 'approved'
    order by decided_at desc limit ${limit}`;
  return {
    total: n,
    trust,
    items: rows.map((r) => ({
      id: r["id"] as string,
      version: r["version"] as number,
      kind: r["kind"] as "positive" | "negative",
      origin: r["origin"] as string,
      observedAt: (r["observed_at"] as Date).toISOString(),
      fixture: r["fixture"] as EvalFixture,
    })),
    autoApproved: ac,
    autoApprovedRecent: autoRows.map((r) => ({
      id: r["id"] as string,
      version: r["version"] as number,
      kind: r["kind"] as "positive" | "negative",
      origin: r["origin"] as string,
      observedAt: (r["observed_at"] as Date).toISOString(),
      fixture: r["fixture"] as EvalFixture,
    })),
  };
}

/**
 * An analyst's decision on one fixture.
 *
 * A still-pending row changes freely. A row the adjudicator auto-approved can also be revoked:
 * it is withdrawn from the corpus and recorded as the analyst's rejection, which is what
 * "reject to revoke" means in the panel. A row an analyst already decided does not change.
 */
export async function decidePendingFixture(
  id: string,
  version: number,
  approve: boolean,
): Promise<{ ok: boolean }> {
  if (!dbConfigured()) return { ok: false };
  const status = approve ? "approved" : "rejected";
  const rows = await db()`
    update eval_corpus set status = ${status}, decided_at = now(), decided_by = 'analyst'
    where id = ${id} and version = ${version}
      and (status = 'pending' or (status = 'approved' and decided_by = 'autonomous'))
    returning id`;
  return { ok: rows.length > 0 };
}
