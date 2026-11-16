import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageBackend } from "@/shared/contracts/backend";
import type {
  CorpusFixtureRow,
  EvaluationRepo,
  StoredReport,
} from "@/shared/contracts/evaluation-repo";
import type { ServerDocumentStore } from "@/shared/contracts/store";
import { nullEvaluationRepo } from "@/shared/infra/null-repos/evaluation";
import { setServerServices } from "@/shared/infra/server-services.server";
import {
  adjudicationTrust,
  decidePendingFixture,
  getEvalKeyTrends,
  getEvalReports,
  harvestCorpus,
  importGitCorpus,
  listPendingFixtures,
  runAdjudication,
  runEvaluation,
  runEvaluationHealth,
} from "@/shared/infra/evaluation/evaluation.server";
import { claimLock } from "@/shared/infra/evaluation/evaluation-lock.server";
import { seedAgreement } from "@/shared/infra/evaluation/seed-agreement.server";

/**
 * The evaluation jobs reach storage only through `serverServices().evaluation`. These tests drive
 * them against an in-memory EvaluationRepo and prove the null adapter (a backend without SQL)
 * answers what the code answered when `dbConfigured()` was false.
 */

interface FakeState {
  lockHeld: boolean;
  claims: { name: string; ttlMs: number }[];
  releases: string[];
  corpusVersion: number;
  recordedVersions: { version: number; note: string }[];
  gitFixtures: { id: string; kind: string }[];
  reports: StoredReport[];
  pending: CorpusFixtureRow[];
  tally: { status: string; n: number }[];
  decisions: { id: string; version: number; status: string }[];
}

function fakeRepo(state: FakeState): EvaluationRepo {
  return {
    tryClaim: async (name, ttlMs) => {
      state.claims.push({ name, ttlMs });
      if (state.lockHeld) return false;
      state.lockHeld = true;
      return true;
    },
    release: async (name) => {
      state.releases.push(name);
      state.lockHeld = false;
    },
    pinnedVersion: async () => state.corpusVersion,
    recordVersion: async (version, note) => {
      state.recordedVersions.push({ version, note });
    },
    gitFixtureExists: async (id) => state.gitFixtures.some((f) => f.id === id),
    insertGitFixture: async ({ id, kind }) => {
      state.gitFixtures.push({ id, kind });
    },
    fixtureIdExists: async () => false,
    insertHarvestedFixture: async () => {},
    adjudicatedIds: async () => [],
    insertAdjudicatedPositive: async () => {},
    insertAdjudicatedNegative: async () => {},
    analystTally: async () => state.tally,
    revokeAutonomousApprovals: async () => {},
    countPending: async () => state.pending.length,
    listPending: async (limit) => state.pending.slice(0, limit),
    countAutoApproved: async () => 0,
    listAutoApproved: async () => [],
    decide: async (id, version, status) => {
      state.decisions.push({ id, version, status });
      return state.pending.some((p) => p.id === id && p.version === version);
    },
    insertReport: async ({ id, generatedAt, report }) => {
      state.reports.unshift({
        id,
        generatedAt: new Date(generatedAt),
        report: report as Record<string, unknown>,
      });
    },
    latestReport: async () => state.reports[0]?.report ?? null,
    newestReportsAscending: async (limit) => state.reports.slice(0, limit).reverse(),
    recentReports: async (limit) => state.reports.slice(0, limit),
  };
}

function freshState(): FakeState {
  return {
    lockHeld: false,
    claims: [],
    releases: [],
    corpusVersion: 7,
    recordedVersions: [],
    gitFixtures: [],
    reports: [],
    pending: [],
    tally: [],
    decisions: [],
  };
}

const emptyStore = { load: async () => [] } as unknown as ServerDocumentStore;

function sqlBackend(): StorageBackend {
  return {
    kind: "postgres",
    capabilities: { revisions: true, sql: true },
    serverStorage: true,
    documents: async () => emptyStore,
    archiveCounts: async () => null,
  };
}

afterEach(() => {
  setServerServices(null);
  vi.unstubAllEnvs();
});

describe("the evaluation jobs against an in-memory EvaluationRepo", () => {
  let state: FakeState;
  beforeEach(() => {
    state = freshState();
    setServerServices({
      backend: sqlBackend(),
      evaluation: fakeRepo(state),
      seedAudit: { seedAuditRows: async () => [] },
    });
  });

  it("takes the named lock for its ttl and releases it after a run", async () => {
    const res = await runEvaluation();

    expect(res.ran).toBe(true);
    expect(state.claims).toEqual([{ name: "evaluation", ttlMs: 10 * 60 * 1000 }]);
    expect(state.releases).toEqual(["evaluation"]);
    expect(state.lockHeld).toBe(false);
  });

  it("stores the report with the pinned seed and the corpus version it read", async () => {
    const res = await runEvaluation();

    expect(res.reportId).toBeTruthy();
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]?.id).toBe(res.reportId);
    expect(res.totalItems).toBe(state.reports[0]?.report["totalItems"]);
  });

  it("reports a held lock as 'lock held' and does not release another run's lock", async () => {
    state.lockHeld = true;

    expect(await claimLock()).toEqual({ ok: false, reason: "lock held" });
    expect(await runEvaluation()).toEqual({ ran: false, reason: "lock held" });
    expect(state.releases).toEqual([]);
  });

  it("reports a claim that throws as 'lock unavailable' with the provider's wording", async () => {
    setServerServices({
      backend: sqlBackend(),
      evaluation: {
        ...fakeRepo(state),
        tryClaim: async () => {
          throw new Error("connection refused");
        },
      },
    });

    expect(await claimLock()).toEqual({
      ok: false,
      reason: "lock unavailable: connection refused",
    });
    expect((await harvestCorpus()).reason).toBe("lock unavailable: connection refused");
    expect((await runAdjudication()).ran).toBe(false);
  });

  it("compares a health run with the report stored before it", async () => {
    state.reports.unshift({
      id: "prev",
      generatedAt: new Date("2026-01-01T00:00:00Z"),
      report: { summary: { f1: 0.9 }, perKey: {}, mismatches: [] },
    });

    const res = await runEvaluationHealth();

    expect(res.ran).toBe(true);
    expect(res.regression).toBe(true);
    expect(res.details[0]).toContain("Total F1 dropped: 0.900");
    // The new report is stored after the previous one was read.
    expect(state.reports.map((r) => r.id)).toEqual([res.reportId, "prev"]);
  });

  it("says so when there is no previous report", async () => {
    const res = await runEvaluationHealth();

    expect(res.regression).toBe(false);
    expect(res.details).toContain("No previous report for comparison (first run)");
  });

  it("imports git fixtures once and skips the ones already imported", async () => {
    const first = await importGitCorpus();
    expect(first.imported).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);
    expect(state.gitFixtures.some((f) => f.kind === "negative")).toBe(true);

    const second = await importGitCorpus();
    expect(second).toEqual({ imported: 0, skipped: first.imported });
  });

  it("maps stored reports to the rows the Evaluation page shows", async () => {
    state.reports = [
      {
        id: "b",
        generatedAt: new Date("2026-02-02T00:00:00Z"),
        report: {
          totalItems: 40,
          summary: { f1: 0.5, precision: 0.6, recall: 0.4 },
          perKey: { speed: { f1: 0.7 } },
        },
      },
      {
        id: "a",
        generatedAt: new Date("2026-01-01T00:00:00Z"),
        report: { totalItems: 30, summary: {}, perKey: { speed: { f1: 0.3 } } },
      },
    ];

    expect(await getEvalReports(5)).toEqual([
      {
        id: "b",
        generatedAt: "2026-02-02T00:00:00.000Z",
        totalItems: 40,
        f1: 0.5,
        precision: 0.6,
        recall: 0.4,
      },
      {
        id: "a",
        generatedAt: "2026-01-01T00:00:00.000Z",
        totalItems: 30,
        f1: 0,
        precision: 0,
        recall: 0,
      },
    ]);
    // Oldest first for the sparkline.
    expect(await getEvalKeyTrends(5)).toEqual([
      {
        key: "speed",
        values: [0.3, 0.7],
        dates: ["2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z"],
      },
    ]);
  });

  it("derives the adjudicator's trust from the analyst's tally", async () => {
    state.tally = [
      { status: "approved", n: 30 },
      { status: "rejected", n: 1 },
    ];

    const trust = await adjudicationTrust();

    expect(trust.agreed).toBe(30);
    expect(trust.disagreed).toBe(1);
  });

  it("lists pending fixtures with ISO timestamps and decides one", async () => {
    state.pending = [
      {
        id: "fx-1",
        version: 1,
        kind: "positive",
        origin: "adjudication",
        observedAt: new Date("2026-03-03T00:00:00Z"),
        fixture: { id: "fx-1" },
      },
    ];

    const list = await listPendingFixtures(10);
    expect(list.total).toBe(1);
    expect(list.items[0]?.observedAt).toBe("2026-03-03T00:00:00.000Z");

    expect(await decidePendingFixture("fx-1", 1, true)).toEqual({ ok: true });
    expect(await decidePendingFixture("nope", 1, false)).toEqual({ ok: false });
    expect(state.decisions[0]).toEqual({ id: "fx-1", version: 1, status: "approved" });
    expect(state.decisions[1]?.status).toBe("rejected");
  });

  it("reads the seed set through the port and scores nothing when it has no answers", async () => {
    const res = await seedAgreement();

    expect(res.available).toBe(true);
    expect(res.reason).toBe("the seed set has no answers yet");
  });
});

describe("a backend without SQL (the null adapter) answers as dbConfigured() === false did", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    setServerServices(null);
  });

  it("does not run the jobs and says why", async () => {
    expect(await runEvaluation()).toEqual({ ran: false, reason: "no database configured" });
    expect(await runEvaluationHealth()).toEqual({
      ran: false,
      reason: "no database configured",
      regression: false,
      details: [],
    });
    expect(await harvestCorpus()).toEqual({
      ran: false,
      reason: "no database configured",
      inserted: 0,
      skipped: 0,
    });
    expect(await runAdjudication()).toEqual({
      ran: false,
      reason: "no database configured",
      adjudicated: 0,
      inserted: 0,
    });
    expect(await importGitCorpus()).toEqual({ imported: 0, skipped: 0 });
  });

  it("returns the empty reads", async () => {
    expect(await getEvalReports()).toEqual([]);
    expect(await getEvalKeyTrends()).toEqual([]);
    expect(await decidePendingFixture("x", 1, true)).toEqual({ ok: false });
    const trust = await adjudicationTrust();
    expect(trust).toMatchObject({ agreed: 0, disagreed: 0 });
    expect(await listPendingFixtures()).toMatchObject({
      total: 0,
      items: [],
      autoApproved: 0,
      autoApprovedRecent: [],
    });
    expect(await seedAgreement()).toMatchObject({
      available: false,
      reason: "no database configured",
    });
  });

  it("keeps the operations that never guarded failing the way an unset DATABASE_URL did", async () => {
    await expect(nullEvaluationRepo.pinnedVersion()).rejects.toThrow("DATABASE_URL not set");
    await expect(nullEvaluationRepo.tryClaim("evaluation", 1)).rejects.toThrow(
      "DATABASE_URL not set",
    );
    expect(await claimLock()).toEqual({
      ok: false,
      reason: "lock unavailable: DATABASE_URL not set",
    });
  });
});
