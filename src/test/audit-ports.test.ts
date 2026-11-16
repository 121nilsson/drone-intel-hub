import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  db: vi.fn(() => {
    throw new Error("the database driver must not be touched");
  }),
}));

vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: () => false,
  db: hoisted.db,
}));

import type { Drone, SpecClaim } from "@/entities/drone/types";
import type {
  AuditDrawTx,
  AuditInsertRow,
  AuditRepo,
  AuditRow,
  DesignRow,
  ReaderRecord,
  ReaderRow,
  RetryRow,
  SampleUnitInsert,
} from "@/shared/contracts/audit-repo";
import { nullAuditRepo } from "@/shared/infra/null-repos/audit";
import { setServerServices } from "@/shared/infra/server-services.server";
import {
  answerAudit,
  auditDisagreements,
  auditStatus,
  disputeControl,
  drawFirstSession,
  drawFormalEvaluation,
  drawMore,
  redrawVoided,
  setSecondLook,
} from "@/shared/infra/verification/audit.server";

const claim = (over: Record<string, unknown> = {}): SpecClaim =>
  ({
    id: "c1",
    value: 40,
    raw: "40 km",
    source: "Reuters",
    sourceId: "p1",
    date: "2026-11-01",
    evidence: "range of 40 km",
    verification: {
      state: "verified",
      verifierVersion: "v1",
      checks: [{ kind: "unit_dimension", verdict: "pass" }],
    },
    ...over,
  }) as unknown as SpecClaim;

const drone: Drone = {
  id: "lancet-3",
  name: "Lancet-3",
  aliases: [],
  specs: [{ key: "range", label: "Range", unit: "km", discoveredBy: "ai", claims: [claim()] }],
} as unknown as Drone;

const POST = "The Lancet-3 has a range of 40 km according to the maker.";

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: "r1",
  batch_id: "b1",
  position: 0,
  role: "audit",
  in_seed: false,
  drone_id: "lancet-3",
  drone_name: "Lancet-3",
  spec_label: "Range",
  claim_id: "c1",
  language: "en",
  family: "range",
  value: "40 km",
  evidence: "range of 40 km",
  source: "Reuters",
  source_id: "p1",
  answer: null,
  obviously_wrong: false,
  read_via: null,
  drawn_at: new Date("2026-11-02T10:00:00Z"),
  ...over,
});

/**
 * An in-memory AuditRepo. It records every call, runs a draw's callback against a fake unit of
 * work and answers the reads from what the test sets, so the domain's decisions are all that is
 * under test.
 */
function fakeAudit(
  init: {
    drones?: Drone[];
    posts?: Record<string, string>;
    seedSetSize?: number;
    audited?: string[];
    design?: DesignRow;
    designRows?: AuditRow[];
    retryRows?: RetryRow[];
    statusRows?: AuditRow[] | null;
    answered?: Awaited<ReturnType<AuditRepo["answeredRows"]>>;
    readers?: ReaderRecord[];
  } = {},
) {
  const calls: string[] = [];
  const log = {
    transactions: 0,
    diagnosticDesigns: [] as Parameters<AuditDrawTx["insertDiagnosticDesign"]>[0][],
    formalDesigns: [] as Parameters<AuditDrawTx["insertFormalDesign"]>[0][],
    units: [] as SampleUnitInsert[],
    rows: [] as AuditInsertRow[],
    readerRows: [] as ReaderRow[],
    retries: [] as { batchId: string; seed: number; ids: readonly string[] }[],
  };
  let design = init.design;
  const tx: AuditDrawTx = {
    auditedClaimIds: async () => init.audited ?? [],
    latestFormalDesign: async () => design,
    formalDesignRows: async () => init.designRows ?? [],
    seedSetSize: async () => init.seedSetSize ?? 0,
    retryCandidates: async () => init.retryRows ?? [],
    insertDiagnosticDesign: async (d) => {
      log.diagnosticDesigns.push(d);
      return "design-diagnostic";
    },
    insertFormalDesign: async (d) => {
      log.formalDesigns.push(d);
      design = {
        id: "design-formal",
        sampling_design: d.samplingDesign as unknown as DesignRow["sampling_design"],
      };
      return "design-formal";
    },
    insertSampleUnits: async (units) => {
      log.units.push(...units);
      return units.map((u, i) => ({ id: `unit-${i}`, claim_id: u.claim_id }));
    },
    insertAuditRows: async (rows) => {
      log.rows.push(...rows);
      return rows.map((r, i) => ({ id: `audit-${i}`, position: r.position }));
    },
    appendReaderRows: async (rows) => {
      log.readerRows.push(...rows);
    },
    insertRetryRows: async (retry) => {
      log.retries.push(retry);
    },
  };
  const answers: { op: string; input: unknown; found: boolean }[] = [];
  let found = true;
  const repo: AuditRepo = {
    allDrones: async () => {
      calls.push("allDrones");
      return init.drones ?? [];
    },
    claimPostTexts: async (ids) =>
      ids.flatMap((id) => (init.posts?.[id] !== undefined ? [{ id, text: init.posts[id]! }] : [])),
    drawTransaction: async (draw) => {
      calls.push("drawTransaction");
      log.transactions++;
      return await draw(tx);
    },
    recordAnswer: async (input) => {
      answers.push({ op: "answer", input, found });
      return found;
    },
    recordDispute: async (input) => {
      answers.push({ op: "dispute", input, found });
      return found;
    },
    recordSecondLook: async (input) => {
      answers.push({ op: "secondLook", input, found });
      return found;
    },
    auditedClaimIds: tx.auditedClaimIds,
    latestFormalDesign: tx.latestFormalDesign,
    formalDesignRows: tx.formalDesignRows,
    statusRows: async () => (init.statusRows === undefined ? [] : init.statusRows),
    readerRecords: async (ids) => {
      calls.push(`readerRecords:${ids.join(",")}`);
      return init.readers ?? [];
    },
    postTextOf: async () => "the frozen post",
    countUndrawn: async () => {
      calls.push("countUndrawn");
      return 5;
    },
    answeredRows: async () => init.answered ?? [],
    unitSiblings: async () => {
      calls.push("unitSiblings");
      return [];
    },
    auditedClaimIdsExceptControls: async () => [],
    fingerprintedItems: async () => [],
    appendReaderRows: async () => {},
    legacyItemsWithoutHistory: async () => [],
    currentReadings: async () => [],
    markReaderStateLegacy: async () => {},
  };
  return { repo, log, calls, answers, missing: () => (found = false) };
}

const use = (repo: AuditRepo) => setServerServices({ audit: repo });

afterEach(() => {
  setServerServices(null);
  vi.unstubAllEnvs();
});

describe("drawing through the AuditRepo port", () => {
  it("draws more claims in one locked unit of work, reading the catalogue before it", async () => {
    const fake = fakeAudit({ drones: [drone], posts: { p1: POST } });
    use(fake.repo);

    const drawn = await drawMore(5);

    expect(drawn.size).toBeGreaterThan(0);
    expect(drawn.batchId).toMatch(/^audit-/);
    // The catalogue is read outside the lock, the freeze happens inside the one transaction.
    expect(fake.calls).toEqual(["allDrones", "drawTransaction"]);
    expect(fake.log.transactions).toBe(1);
    expect(fake.log.diagnosticDesigns).toEqual([
      expect.objectContaining({
        purpose: "diagnostic",
        samplingDesign: { draw: "round_robin", batchId: drawn.batchId },
        populationSize: 1,
        sampleSize: drawn.size,
      }),
    ]);
    const audited = fake.log.rows.filter((r) => r.role === "audit");
    expect(audited.map((r) => r.claim_id)).toEqual(["c1"]);
    for (const r of fake.log.rows) {
      expect(r.batch_id).toBe(drawn.batchId);
      expect(r.in_seed).toBe(false);
      expect(r.audit_batch_id).toBe("design-diagnostic");
      expect(r.sampling_purpose).toBe("diagnostic");
      expect(r.claim_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(r.reader_state_at_draw).toBe("none");
    }
    // No claim carried a reading, so no reader row is appended.
    expect(fake.log.readerRows).toEqual([]);
  });

  it("skips claims that were already drawn, and says so when none is left", async () => {
    const fake = fakeAudit({ drones: [drone], posts: { p1: POST }, audited: ["c1"] });
    use(fake.repo);

    await expect(drawMore(5)).rejects.toThrow("Every verified claim with a post has been audited.");
    expect(fake.log.rows).toEqual([]);
  });

  it("refuses a second first session once the seed set is frozen", async () => {
    const fake = fakeAudit({ drones: [drone], posts: { p1: POST }, seedSetSize: 3 });
    use(fake.repo);

    await expect(drawFirstSession()).rejects.toThrow(
      "The first session has already been drawn; the seed set is frozen.",
    );
    expect(fake.log.rows).toEqual([]);
  });

  it("draws nothing for a first session without a verified claim that has a post", async () => {
    const fake = fakeAudit({ drones: [drone], posts: {} });
    use(fake.repo);

    await expect(drawFirstSession()).rejects.toThrow(
      "There are no verified claims with a post to audit yet.",
    );
  });

  it("freezes a formal design, its sample units and its rows, and then refuses a second one", async () => {
    const fake = fakeAudit({ drones: [drone], posts: { p1: POST } });
    use(fake.repo);

    const drawn = await drawFormalEvaluation();

    expect(fake.log.formalDesigns).toHaveLength(1);
    expect(fake.log.formalDesigns[0]).toMatchObject({ sampleSize: 1, populationSize: 1 });
    expect(fake.log.formalDesigns[0]!.samplingDesign).toMatchObject({
      populationFrameHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      eligibilityCutoff: expect.any(String),
    });
    expect(fake.log.units).toEqual([
      expect.objectContaining({ audit_batch_id: "design-formal", claim_id: "c1" }),
    ]);
    const audited = fake.log.rows.filter((r) => r.role === "audit");
    expect(audited).toEqual([
      expect.objectContaining({
        claim_id: "c1",
        sampling_purpose: "formal_eval",
        audit_batch_id: "design-formal",
        sample_unit_id: "unit-0",
      }),
    ]);
    // The design is not recorded a second time as a diagnostic one.
    expect(fake.log.diagnosticDesigns).toEqual([]);
    expect(drawn.size).toBe(fake.log.rows.length);

    // The stored design still waits for its answers: a new one is refused.
    const open = fakeAudit({
      drones: [drone],
      posts: { p1: POST },
      design: {
        id: "design-formal",
        sampling_design: fake.log.formalDesigns[0]!.samplingDesign as never,
      },
      designRows: [],
    });
    use(open.repo);
    await expect(drawFormalEvaluation()).rejects.toThrow(
      "The formal evaluation is still waiting for answers.",
    );
    expect(open.log.formalDesigns).toEqual([]);
  });

  it("asks again about a sample unit whose only answer a failed control voided", async () => {
    const answered = row({ id: "a1", position: 0, answer: "yes", sample_unit_id: "u1" });
    const control = row({
      id: "k1",
      position: 1,
      role: "control",
      answer: "yes",
      control_kind: "altered",
      sample_unit_id: null,
    });
    const fake = fakeAudit({
      design: { id: "d1", sampling_design: {} as never },
      retryRows: [answered, control] as RetryRow[],
    });
    use(fake.repo);

    const retry = await redrawVoided();

    expect(retry).toEqual({ batchId: expect.stringMatching(/^audit-retry-/), size: 1 });
    expect(fake.log.retries).toEqual([
      { batchId: retry!.batchId, seed: expect.any(Number), ids: ["a1"] },
    ]);
  });

  it("asks again about nothing when no design exists or every unit is settled", async () => {
    use(fakeAudit().repo);
    expect(await redrawVoided()).toBeNull();

    const settled = fakeAudit({
      design: { id: "d1", sampling_design: {} as never },
      retryRows: [row({ id: "a1", answer: "yes", sample_unit_id: "u1" })] as RetryRow[],
    });
    use(settled.repo);
    expect(await redrawVoided()).toBeNull();
    expect(settled.log.retries).toEqual([]);
  });
});

describe("answers through the AuditRepo port", () => {
  it("passes the answer on and fails with the old message when no row qualifies", async () => {
    const fake = fakeAudit();
    use(fake.repo);
    const input = {
      id: "r1",
      answer: "yes",
      obviouslyWrong: false,
      readVia: "original",
    } as const;

    await answerAudit(input);
    fake.missing();
    await expect(answerAudit(input)).rejects.toThrow("No such audit item");

    expect(fake.answers[0]).toEqual({ op: "answer", input, found: true });
  });

  it("stamps a dispute with the time now and withdraws one with null", async () => {
    const fake = fakeAudit();
    use(fake.repo);

    await disputeControl({ id: "k1", disputed: true });
    await disputeControl({ id: "k1", disputed: false });

    expect(fake.answers[0]!.input).toEqual({ id: "k1", disputedAt: expect.any(Date) });
    expect(fake.answers[1]!.input).toEqual({ id: "k1", disputedAt: null });
    fake.missing();
    await expect(disputeControl({ id: "k1", disputed: true })).rejects.toThrow(
      "Only a control of the first sessions' kind can be disputed",
    );
  });

  it("records a second look, or clears it, and fails when the item is not an answered one", async () => {
    const fake = fakeAudit();
    use(fake.repo);

    await setSecondLook({ id: "r1", look: null });
    expect(fake.answers[0]).toEqual({
      op: "secondLook",
      input: { id: "r1", look: null },
      found: true,
    });
    fake.missing();
    await expect(setSecondLook({ id: "r1", look: null })).rejects.toThrow(
      "No such answered audit item",
    );
  });
});

describe("the audit's state through the AuditRepo port", () => {
  it("builds the status from the rows, attaches the frozen reading and the next claim's post", async () => {
    const answered = row({ id: "r0", position: 0, answer: "no" });
    const open = row({ id: "r1", position: 1 });
    const fake = fakeAudit({
      statusRows: [answered, open],
      readers: [
        {
          audit_id: "r0",
          phase: "at_draw",
          verdict: "supported",
          independence: "checked",
          evaluated_at: new Date("2026-11-02T09:00:00Z"),
          before_human_answer: true,
          span: null,
          note: null,
        },
      ],
    });
    use(fake.repo);

    const status = await auditStatus({ countUndrawn: true });

    expect(status.available).toBe(true);
    expect(status.next).toMatchObject({ id: "r1", postText: "the frozen post" });
    expect(status.undrawn).toBe(5);
    expect(status.reader?.measured).toBe(1);
    expect(fake.calls).toContain("readerRecords:r0,r1");
  });

  it("counts the undrawn claims only when asked", async () => {
    const fake = fakeAudit({ statusRows: [row()] });
    use(fake.repo);

    const status = await auditStatus();

    expect(status.undrawn).toBeUndefined();
    expect(fake.calls).not.toContain("countUndrawn");
  });

  it("lists the answers the reader contradicted, with the reading frozen at draw", async () => {
    const fake = fakeAudit({
      answered: [
        { ...row({ answer: "yes" }), post_text: POST, second_look: null, control_kind: null },
      ],
      readers: [
        {
          audit_id: "r1",
          phase: "at_draw",
          verdict: "contradicted",
          independence: "checked",
          evaluated_at: new Date("2026-11-02T09:00:00Z"),
          before_human_answer: true,
          span: "range of 40 km",
          note: "different figure",
        },
      ],
    });
    use(fake.repo);

    const disagreements = await auditDisagreements();

    expect(disagreements).toEqual([
      expect.objectContaining({
        id: "r1",
        answer: "yes",
        reader: "contradicted",
        readerSpan: "range of 40 km",
        readerNote: "different figure",
        postText: POST,
      }),
    ]);
    expect(fake.calls).not.toContain("unitSiblings");
  });
});

describe("the null adapter reproduces the old no-database behaviour", () => {
  const noDatabase = () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    setServerServices(null);
  };

  it("answers the audit page with the empty status and no disagreements", async () => {
    noDatabase();

    expect(await auditStatus()).toMatchObject({
      available: false,
      decision: "continue",
      overall: { answered: 0, errors: 0, cannotTell: 0, upperBound: 1 },
      openCount: 0,
      seed: { size: 0, answered: 0, frozen: false },
    });
    expect(await auditDisagreements()).toEqual([]);
  });

  it("throws what db() threw for every draw, answer and backfill", async () => {
    noDatabase();

    await expect(drawFirstSession()).rejects.toThrow("DATABASE_URL not set");
    await expect(drawMore()).rejects.toThrow("DATABASE_URL not set");
    await expect(drawFormalEvaluation()).rejects.toThrow("DATABASE_URL not set");
    await expect(redrawVoided()).rejects.toThrow("DATABASE_URL not set");
    await expect(
      answerAudit({ id: "r1", answer: "yes", obviouslyWrong: false, readVia: "original" }),
    ).rejects.toThrow("DATABASE_URL not set");
    await expect(disputeControl({ id: "k1", disputed: true })).rejects.toThrow(
      "DATABASE_URL not set",
    );
    await expect(setSecondLook({ id: "r1", look: null })).rejects.toThrow("DATABASE_URL not set");
    await expect(nullAuditRepo.legacyItemsWithoutHistory()).rejects.toThrow("DATABASE_URL not set");
    expect(hoisted.db).not.toHaveBeenCalled();
  });
});
