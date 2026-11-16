import { serverServices } from "@/shared/infra/server-services.server";
import type { CorpusFixtureRow } from "@/shared/contracts/evaluation-repo";
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

function pendingFixture(r: CorpusFixtureRow): PendingFixture {
  return {
    id: r.id,
    version: r.version,
    kind: r.kind,
    origin: r.origin,
    observedAt: r.observedAt.toISOString(),
    fixture: r.fixture as EvalFixture,
  };
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
  const { evaluation } = serverServices();
  const n = await evaluation.countPending();
  const rows = await evaluation.listPending(limit);
  const ac = await evaluation.countAutoApproved();
  const autoRows = await evaluation.listAutoApproved(limit);
  return {
    total: n,
    trust,
    items: rows.map(pendingFixture),
    autoApproved: ac,
    autoApprovedRecent: autoRows.map(pendingFixture),
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
  const status = approve ? "approved" : "rejected";
  return { ok: await serverServices().evaluation.decide(id, version, status) };
}
