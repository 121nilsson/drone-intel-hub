import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageBackend } from "@/shared/contracts/backend";
import type { LedgerRecord, LedgerRepo } from "@/shared/contracts/ledger-repo";
import type { TaskRunRepo, TaskRunRow } from "@/shared/contracts/task-run-repo";
import type { SyncSlotRow, SyncStateRepo } from "@/shared/contracts/sync-state-repo";
import type {
  SourceFetchHistoryRow,
  SourceFetchRecord,
  SourceFetchTotals,
  SourceLogRepo,
} from "@/shared/contracts/source-log-repo";
import type { SourceSyncRepo } from "@/shared/contracts/source-sync-repo";
import type { BriefingRepo } from "@/shared/contracts/briefing-repo";
import type { BriefingSummaryStored } from "@/shared/contracts/briefing-summary";
import { HEARTBEAT_EVENT_KINDS } from "@/shared/contracts/verification";
import { setServerServices } from "@/shared/infra/server-services.server";
import { nullLedgerRepo } from "@/shared/infra/null-repos/ledger";
import { nullTaskRunRepo } from "@/shared/infra/null-repos/taskRuns";
import { nullSyncStateRepo } from "@/shared/infra/null-repos/syncState";
import { nullSourceLogRepo } from "@/shared/infra/null-repos/sourceLog";
import { nullSourceSyncRepo } from "@/shared/infra/null-repos/sourceSync";
import { nullBriefingRepo } from "@/shared/infra/null-repos/briefing";
import { listAutonomyEvents, recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import { listTaskStatus, recordTaskRun } from "@/shared/infra/task-runs.server";
import { readSyncState } from "@/shared/infra/sync-state-read.server";
import { listSourceFetchHealth, recordSourceFetch } from "@/shared/infra/sources/fetch-log.server";
import { runAutoSync } from "@/shared/infra/sources/source-sync.server";
import {
  getSharedBriefingSummary,
  putSharedBriefingSummary,
  resolveSharedBriefingSummary,
} from "@/shared/infra/briefing-summary.server";

const backend = (sql: boolean): StorageBackend => ({
  kind: sql ? "postgres" : "none",
  capabilities: { revisions: true, sql },
  serverStorage: sql,
  documents: async () => {
    throw new Error("documents() is not used here");
  },
  archiveCounts: async () => null,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setServerServices(null);
  vi.restoreAllMocks();
});

describe("ledger over its port", () => {
  const fake = () => {
    const appended: LedgerRecord[] = [];
    const pruned: Array<{ kinds: readonly string[]; keep: number }> = [];
    const repo: LedgerRepo = {
      append: vi.fn(async (r) => {
        appended.push(r);
      }),
      pruneHeartbeats: vi.fn(async (kinds, keep) => {
        pruned.push({ kinds, keep });
      }),
      recent: vi.fn(async () => []),
    };
    return { repo, appended, pruned };
  };

  it("appends a trimmed record and prunes only after a heartbeat kind", async () => {
    const { repo, appended, pruned } = fake();
    setServerServices({ ledger: repo });
    await recordAutonomyEvent({
      action: "assertion_frame_check",
      actor: "a".repeat(300),
      actorKind: "verifier",
      targetCollection: "drones",
      targetId: "x",
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]!.actor).toHaveLength(200);
    expect(appended[0]).toMatchObject({ reversible: true, category: null, correlationId: null });
    expect(pruned).toEqual([]);

    await recordAutonomyEvent({
      action: HEARTBEAT_EVENT_KINDS[0]!,
      actor: "a",
      actorKind: "verifier",
      targetCollection: "drones",
      targetId: "x",
    });
    expect(pruned).toEqual([{ kinds: [...HEARTBEAT_EVENT_KINDS], keep: 2000 }]);
  });

  it("logs and drops a failed write, and clamps the read limit", async () => {
    const { repo } = fake();
    repo.append = vi.fn(async () => {
      throw new Error("down");
    });
    repo.recent = vi.fn(async () => {
      throw new Error("down");
    });
    setServerServices({ ledger: repo });
    await expect(
      recordAutonomyEvent({
        action: "verification_run",
        actor: "a",
        actorKind: "verifier",
        targetCollection: "drones",
        targetId: "x",
      }),
    ).resolves.toBeUndefined();
    expect(await listAutonomyEvents(5000)).toEqual([]);
    expect(repo.recent).toHaveBeenCalledWith(500);
  });

  it("does nothing and reads nothing through the null adapter", async () => {
    setServerServices({ ledger: nullLedgerRepo });
    await expect(
      recordAutonomyEvent({
        action: "verification_run",
        actor: "a",
        actorKind: "verifier",
        targetCollection: "drones",
        targetId: "x",
      }),
    ).resolves.toBeUndefined();
    expect(await listAutonomyEvents()).toEqual([]);
  });
});

describe("task runs over their port", () => {
  it("prunes, begins and finishes a run, passing the result through", async () => {
    const calls: string[] = [];
    const repo: TaskRunRepo = {
      prune: vi.fn(async (days) => {
        calls.push(`prune:${days}`);
      }),
      begin: vi.fn(async (task, trigger) => {
        calls.push(`begin:${task}:${trigger}`);
        return 7;
      }),
      finish: vi.fn(async (id, outcome) => {
        calls.push(`finish:${id}:${outcome.status}`);
      }),
      recent: vi.fn(async () => []),
    };
    setServerServices({ taskRuns: repo });
    const result = await recordTaskRun(
      "t",
      "manual",
      async () => 42,
      () => ({ status: "ok", summary: "s".repeat(900) }),
    );
    expect(result).toBe(42);
    expect(calls).toEqual(["prune:30", "begin:t:manual", "finish:7:ok"]);
    expect((repo.finish as ReturnType<typeof vi.fn>).mock.calls[0]![1].summary).toHaveLength(500);
  });

  it("records a failure and rethrows it", async () => {
    const repo: TaskRunRepo = {
      prune: async () => {},
      begin: async () => 1,
      finish: vi.fn(async () => {}),
      recent: async () => [],
    };
    setServerServices({ taskRuns: repo });
    await expect(
      recordTaskRun(
        "t",
        "schedule",
        async () => {
          throw new Error("boom");
        },
        () => ({ status: "ok", summary: "" }),
      ),
    ).rejects.toThrow("boom");
    expect(repo.finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "failed", error: "boom", summary: null }),
    );
  });

  it("builds the status from stored rows, and from none through the null adapter", async () => {
    const started = new Date("2026-01-01T00:00:00Z");
    const first = (await listTaskStatus())[0]!;
    const row: TaskRunRow = {
      task: first.name,
      trigger: "schedule",
      startedAt: started,
      durationMs: 1200,
      status: "ok",
      summary: "did it",
      error: null,
    };
    setServerServices({ taskRuns: { ...nullTaskRunRepo, recent: async () => [row] } });
    const status = (await listTaskStatus(new Date("2026-01-01T00:10:00Z")))[0]!;
    expect(status.last).toMatchObject({ status: "ok", summary: "did it", durationMs: 1200 });
    expect(status.recentMs).toEqual([1200]);

    setServerServices({ taskRuns: nullTaskRunRepo });
    const empty = (await listTaskStatus())[0]!;
    expect(empty.last).toBeUndefined();
    expect(empty.recentMs).toEqual([]);
    expect(await nullTaskRunRepo.begin("t", "manual")).toBeUndefined();
  });
});

describe("sync state over its port", () => {
  it("reads the throttle slots through the port", async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    const rows: SyncSlotRow[] = [
      { name: "sources:auto", lastSync: new Date("2026-02-02T00:00:00Z"), lastResult: null },
      { name: "sources:cooldown", lastSync: null, lastResult: { level: 1, until } },
    ];
    const repo: SyncStateRepo = { readSlots: vi.fn(async () => rows) };
    setServerServices({ syncState: repo });
    expect(await readSyncState()).toEqual({
      lastSync: "2026-02-02T00:00:00.000Z",
      configured: true,
      progress: null,
      cooldownUntil: until,
    });
    expect(repo.readSlots).toHaveBeenCalledWith([
      "sources:auto",
      "sources:progress",
      "sources:cooldown",
    ]);
  });

  it("returns the partial state when the read fails", async () => {
    setServerServices({
      syncState: {
        readSlots: async () => {
          throw new Error("down");
        },
      },
    });
    expect(await readSyncState()).toMatchObject({ configured: true, lastSync: null });
  });

  it("reports sync as unavailable through the null adapter", async () => {
    setServerServices({ syncState: nullSyncStateRepo });
    expect(await readSyncState()).toEqual({
      lastSync: null,
      configured: false,
      progress: null,
      cooldownUntil: null,
    });
  });
});

describe("source fetch log over its port", () => {
  it("trims the error and builds health from totals and history", async () => {
    const appended: SourceFetchRecord[] = [];
    const totals: SourceFetchTotals[] = [
      {
        sourceId: "s1",
        fetches: 3,
        failures: 1,
        fetched: 9,
        relevant: 4,
        lastOkAt: new Date("2026-03-01T00:00:00Z"),
      },
    ];
    const history: SourceFetchHistoryRow[] = [
      {
        sourceId: "s1",
        at: new Date("2026-03-01T00:00:00Z"),
        ok: false,
        fetched: 0,
        relevant: 0,
        error: "timeout",
      },
    ];
    const repo: SourceLogRepo = {
      append: async (e) => {
        appended.push(e);
      },
      prune: vi.fn(async () => {}),
      totals: async () => totals,
      history: async () => history,
    };
    setServerServices({ sourceLog: repo });
    await recordSourceFetch({
      sourceId: "s1",
      ok: false,
      fetched: 0,
      duplicates: 0,
      error: "e".repeat(900),
    });
    expect(appended[0]!.error).toHaveLength(500);
    const health = await listSourceFetchHealth(30, new Date("2026-03-02T00:00:00Z"));
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({
      sourceId: "s1",
      fetches: 3,
      failures: 1,
      lastOkAt: "2026-03-01T00:00:00.000Z",
      lastError: "timeout",
    });
  });

  it("returns an empty health list through the null adapter", async () => {
    setServerServices({ sourceLog: nullSourceLogRepo });
    expect(await listSourceFetchHealth()).toEqual([]);
    await expect(
      recordSourceFetch({ sourceId: "s", ok: true, fetched: 0, duplicates: 0 }),
    ).resolves.toBeUndefined();
  });
});

describe("source sync over its port", () => {
  it("refuses to run without a SQL backend, as before", async () => {
    setServerServices({ backend: backend(false), sourceSync: nullSourceSyncRepo });
    expect(await runAutoSync()).toEqual({
      ran: false,
      reason: "Auto-sync needs DATABASE_URL (PostgreSQL)",
    });
  });

  it("reports a throttled run when the port does not grant the slot", async () => {
    const repo: SourceSyncRepo = { ...nullSourceSyncRepo, claimSlot: vi.fn(async () => false) };
    setServerServices({ backend: backend(true), sourceSync: repo });
    const r = await runAutoSync({ minIntervalMs: 5, force: true });
    expect(r).toEqual({ ran: false, reason: "Throttled: minimum interval not elapsed" });
    expect(repo.claimSlot).toHaveBeenCalledWith(5, true);
  });

  it("reports missing migrations when the slot claim throws", async () => {
    const repo: SourceSyncRepo = {
      ...nullSourceSyncRepo,
      claimSlot: async () => {
        throw new Error("no table");
      },
    };
    setServerServices({ backend: backend(true), sourceSync: repo });
    expect((await runAutoSync()).reason).toContain("sync_state missing");
  });

  it("never grants a slot through the null adapter", async () => {
    expect(await nullSourceSyncRepo.claimSlot(0, true)).toBe(false);
    expect(await nullSourceSyncRepo.readCooldown()).toBeUndefined();
  });
});

describe("briefing summary over its port", () => {
  const stored = (generatedAt: number): BriefingSummaryStored => ({
    summary: "x".repeat(40),
    generatedAt,
    contextFingerprint: "f",
  });

  it("returns a fresh stored summary and ignores a stale one", async () => {
    const now = Date.now();
    let value: unknown = stored(now);
    const repo: BriefingRepo = { readSummary: async () => value, writeSummary: async () => {} };
    setServerServices({ backend: backend(true), briefing: repo });
    expect(await getSharedBriefingSummary("ctx", now)).toEqual(stored(now));
    value = stored(now - 365 * 24 * 3600_000);
    expect(await getSharedBriefingSummary("ctx", now)).toBeNull();
    value = undefined;
    expect(await getSharedBriefingSummary("ctx", now)).toBeNull();
  });

  it("writes a trimmed summary with its context fingerprint, and skips a short one", async () => {
    const writeSummary = vi.fn(async () => {});
    setServerServices({ backend: backend(true), briefing: { ...nullBriefingRepo, writeSummary } });
    await putSharedBriefingSummary("ctx", "  too short ", 1);
    expect(writeSummary).not.toHaveBeenCalled();
    await putSharedBriefingSummary("ctx", `  ${"y".repeat(30)}  `, 5);
    expect(writeSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "y".repeat(30), generatedAt: 5 }),
    );
  });

  it("resolves to null without a SQL backend and never generates", async () => {
    setServerServices({ backend: backend(false), briefing: nullBriefingRepo });
    expect(await resolveSharedBriefingSummary("ctx")).toBeNull();
    expect(await nullBriefingRepo.readSummary()).toBeUndefined();
  });
});
