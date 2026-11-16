import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const log: { on: "pool" | "tx"; sql: string }[] = [];
  let reply: unknown[] = [];
  const connection = (on: "pool" | "tx") => {
    const tag = ((first: unknown, ...values: unknown[]) => {
      // sql`...` is a tagged template; sql(rows) is postgres.js' bulk-insert helper.
      if (Array.isArray(first) && "raw" in first) {
        log.push({ on, sql: (first as unknown as string[]).join("?").replace(/\s+/g, " ").trim() });
        return Promise.resolve(reply);
      }
      return { helper: first, values };
    }) as unknown as ((...a: unknown[]) => unknown) & {
      json: (v: unknown) => unknown;
      begin: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    };
    tag.json = (v) => ({ json: v });
    tag.begin = async (fn) => await fn(connection("tx"));
    return tag;
  };
  return {
    log,
    setReply: (r: unknown[]) => (reply = r),
    pool: connection("pool"),
  };
});

vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: () => true,
  db: () => hoisted.pool,
}));

import { createPostgresAuditRepo } from "@/shared/infra/postgres/audit-repo.server";
import { createPostgresVerificationRepo } from "@/shared/infra/postgres/verification-repo.server";

beforeEach(() => {
  hoisted.log.length = 0;
  hoisted.setReply([]);
});

describe("the PostgreSQL audit adapter", () => {
  it("runs a draw in one transaction that takes the advisory lock first", async () => {
    const repo = createPostgresAuditRepo();
    hoisted.setReply([{ n: 2 }]);

    const size = await repo.drawTransaction(async (tx) => {
      const n = await tx.seedSetSize();
      await tx.insertRetryRows({ batchId: "b", seed: 1, ids: ["a"] });
      return n;
    });

    expect(size).toBe(2);
    // Every statement of the draw ran on the transaction's connection, none on the pool.
    expect(hoisted.log.every((l) => l.on === "tx")).toBe(true);
    expect(hoisted.log[0]!.sql).toContain("pg_advisory_xact_lock(hashtext(");
    expect(hoisted.log[1]!.sql).toContain(
      "select count(*)::int as n from verification_audit where in_seed",
    );
    expect(hoisted.log[2]!.sql).toContain("retry_of_audit_id");
  });

  it("reads outside a transaction on the pool", async () => {
    const repo = createPostgresAuditRepo();

    await repo.statusRows();
    await repo.latestFormalDesign();

    expect(hoisted.log.map((l) => l.on)).toEqual(["pool", "pool"]);
    expect(hoisted.log[1]!.sql).toContain(
      "where purpose = 'formal_eval' order by drawn_at desc limit 1",
    );
  });

  it("says whether an update touched a row", async () => {
    const repo = createPostgresAuditRepo();
    const answer = {
      id: "r1",
      answer: "yes",
      obviouslyWrong: false,
      readVia: "original",
    } as const;

    hoisted.setReply([]);
    expect(await repo.recordAnswer(answer)).toBe(false);
    hoisted.setReply([{ id: "r1" }]);
    expect(await repo.recordAnswer(answer)).toBe(true);
    expect(await repo.recordDispute({ id: "k1", disputedAt: null })).toBe(true);
    expect(await repo.recordSecondLook({ id: "r1", look: null })).toBe(true);
    expect(hoisted.log[2]!.sql).toContain("coalesce(control_kind, 'misread') = 'misread'");
    expect(hoisted.log[3]!.sql).toContain("role <> 'control' and answer in ('yes', 'no')");
  });

  it("appends no reader rows for an empty list", async () => {
    const repo = createPostgresAuditRepo();

    await repo.appendReaderRows([]);

    expect(hoisted.log).toEqual([]);
  });
});

describe("the PostgreSQL verification adapter", () => {
  it("sums today's spend as numbers, zero when nothing was spent", async () => {
    const repo = createPostgresVerificationRepo();

    hoisted.setReply([{ input: "120", output: "12" }]);
    expect(await repo.usedToday(["verifier", "controls"])).toEqual({ input: 120, output: 12 });
    hoisted.setReply([{ input: null, output: null }]);
    expect(await repo.usedToday(["verifier"])).toEqual({ input: 0, output: 0 });
    hoisted.setReply([]);
    expect(await repo.usedToday(["verifier"])).toEqual({ input: 0, output: 0 });
  });

  it("stores a control once per claim and entailment version", async () => {
    const repo = createPostgresVerificationRepo();

    await repo.recordControl({
      claimId: "c1",
      droneId: "d1",
      specKey: "range",
      family: null,
      language: "en",
      sourceId: "p1",
      trueValue: "40 km",
      alteredValue: "160 km",
      verdict: "contradicted",
      span: null,
      provider: "groq",
      model: "m",
      entailmentVersion: "entailment-6",
    });

    expect(hoisted.log[0]!.sql).toContain("on conflict (claim_id, entailment_version) do nothing");
  });
});
