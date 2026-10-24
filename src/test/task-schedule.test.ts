import { describe, expect, it } from "vitest";
import { memoExtractor, runSandbox } from "@/shared/infra/evaluation/sandbox";
import type { Drone, Extraction } from "@/entities/drone/types";
import { nextCronRun } from "@/shared/infra/cron";
import { SCHEDULED_TASKS } from "@/shared/contracts/scheduled-tasks";
import { healthOutcome, ranOutcome, rulesOutcome } from "@/shared/infra/task-runs.server";

const at = (iso: string) => new Date(iso);

describe("nextCronRun", () => {
  it("steps every 10 minutes", () => {
    expect(nextCronRun("*/10 * * * *", at("2026-10-24T10:03:20Z"))?.toISOString()).toBe(
      "2026-10-24T10:10:00.000Z",
    );
    // Exactly on a tick, the next one is the following tick, not now.
    expect(nextCronRun("*/10 * * * *", at("2026-10-24T10:10:00Z"))?.toISOString()).toBe(
      "2026-10-24T10:20:00.000Z",
    );
  });

  it("finds the hourly minute and the daily time", () => {
    expect(nextCronRun("35 * * * *", at("2026-10-24T10:40:00Z"))?.toISOString()).toBe(
      "2026-10-24T11:35:00.000Z",
    );
    expect(nextCronRun("15 3 * * *", at("2026-10-24T04:00:00Z"))?.toISOString()).toBe(
      "2026-10-25T03:15:00.000Z",
    );
  });

  it("reads lists and ranges", () => {
    expect(nextCronRun("0 9-17 * * 1-5", at("2026-10-24T12:30:00Z"))?.toISOString()).toBe(
      // 24 Oct 2026 is a Saturday, so the next weekday 09:00 is Monday.
      "2026-10-26T09:00:00.000Z",
    );
    expect(nextCronRun("0,30 * * * *", at("2026-10-24T12:10:00Z"))?.toISOString()).toBe(
      "2026-10-24T12:30:00.000Z",
    );
  });

  it("can schedule every job in the list", () => {
    for (const t of SCHEDULED_TASKS) expect(nextCronRun(t.cron, new Date())).toBeDefined();
    expect(new Set(SCHEDULED_TASKS.map((t) => t.name)).size).toBe(SCHEDULED_TASKS.length);
  });
});

describe("task outcomes", () => {
  it("maps ran/skipped", () => {
    expect(ranOutcome({ ran: false, reason: "Throttled" })).toEqual({
      status: "skipped",
      summary: "Throttled",
    });
  });

  it("raises an alert for a health regression or a tripped breaker", () => {
    expect(
      healthOutcome({ ran: true, reason: "ok", regression: true, details: ["F1 -0.1"] }).status,
    ).toBe("alert");
    expect(
      rulesOutcome({
        supervise: {
          ran: true,
          reason: "ok",
          breaker: { tripped: true, reasons: ["F1 drop"] },
          quarantined: ["r1"],
        },
        mine: { ran: true, reason: "ok", proposed: 2, passed: 1, sandboxed: 2 },
      }),
    ).toMatchObject({ status: "alert", summary: expect.stringContaining("TRIPPED") });
  });
});

describe("memoExtractor", () => {
  it("reads each text once per catalog and hands out copies", async () => {
    let calls = 0;
    const inner = {
      tier: 1 as const,
      label: "x",
      extract: async (raw: string) => {
        calls++;
        return { name: raw, specs: [] } as unknown as Extraction;
      },
    };
    const m = memoExtractor(inner);
    const catalog: Drone[] = [];
    const a = await m.extract("t", catalog);
    (a as { name: string }).name = "changed";
    const b = await m.extract("t", catalog);
    expect(calls).toBe(1);
    expect(b.name).toBe("t");
    await m.extract("t", []);
    expect(calls).toBe(2);
    expect(memoExtractor(m)).toBe(m);
  });
});

describe("memoExtractor on failure", () => {
  it("does not remember a failed read", async () => {
    let calls = 0;
    const m = memoExtractor({
      tier: 1,
      label: "x",
      extract: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return { specs: [] } as unknown as Extraction;
      },
    });
    const catalog: Drone[] = [];
    await expect(m.extract("t", catalog)).rejects.toThrow("boom");
    await expect(m.extract("t", catalog)).resolves.toBeDefined();
    expect(calls).toBe(2);
  });
});

describe("targeted sandbox", () => {
  it("checks a fixture that names the rule's term in another script", async () => {
    const seen: string[] = [];
    const x = {
      tier: 1 as const,
      label: "x",
      extract: async (raw: string) => {
        seen.push(raw);
        return {
          specs: [],
          rfBands: [],
          aliases: [],
          operators: [],
          confidence: 0,
        } as unknown as Extraction;
      },
    };
    const fx = (id: string, text: string) => ({ id, source: id, text, expect: [] });
    await runSandbox({
      fixtures: [
        fx("cyr", "Удар Ланцетом по позиции"),
        fx("other", "Nothing relevant here at all"),
      ],
      candidates: [],
      catalog: [],
      baseline: x,
      proposed: { ...x },
      terms: ["lancet"],
      mode: "fast",
      controlSize: 0,
    });
    expect(seen).toContain("Удар Ланцетом по позиции");
    expect(seen).not.toContain("Nothing relevant here at all");
  });
});
