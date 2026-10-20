import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceFailure, traceItem, traceLevel, traceStage } from "@/shared/infra/pipeline-trace";
import { processPending } from "@/shared/infra/ingest/auto-ingest";
import type { DispatchRepository } from "@/shared/contracts/repository";
import type { PipelineDeps } from "@/shared/infra/ingest/pipeline";
import type { IntelExtractor } from "@/shared/contracts/ai";

/**
 * Per-item pipeline tracing.
 *
 * The point of the feature is that a failing run can be diagnosed from `docker compose logs app`
 * without opening a browser, so the assertions are about what an operator would actually read:
 * which post, which engine, what was found, what was written.
 */

const savedTrace = process.env["PIPELINE_TRACE"];

/** Collects console.log output so the emitted line itself is under test. */
function captureLogs() {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

afterEach(() => {
  if (savedTrace === undefined) delete process.env["PIPELINE_TRACE"];
  else process.env["PIPELINE_TRACE"] = savedTrace;
  vi.restoreAllMocks();
});

describe("traceLevel", () => {
  it("defaults to on, because a run is exactly when the detail is wanted", () => {
    delete process.env["PIPELINE_TRACE"];
    expect(traceLevel()).toBe(1);
  });

  it("reads off, and verbose", () => {
    for (const v of ["0", "off", "false", "no"]) {
      process.env["PIPELINE_TRACE"] = v;
      expect(traceLevel()).toBe(0);
    }
    for (const v of ["2", "verbose", "debug"]) {
      process.env["PIPELINE_TRACE"] = v;
      expect(traceLevel()).toBe(2);
    }
    process.env["PIPELINE_TRACE"] = "anything-else";
    expect(traceLevel()).toBe(1);
  });
});

describe("traceItem", () => {
  it("joins parts and drops the empty ones", () => {
    process.env["PIPELINE_TRACE"] = "1";
    const c = captureLogs();
    try {
      traceItem(["3/20", "UKRInform", undefined, "", null, "merged"]);
    } finally {
      c.restore();
    }
    // No dangling separators and no "undefined" in the line an operator scans.
    expect(c.lines).toEqual(["[pipeline] 3/20 · UKRInform · merged"]);
  });

  it("says nothing at level 0", () => {
    process.env["PIPELINE_TRACE"] = "0";
    const c = captureLogs();
    try {
      traceItem(["3/20", "UKRInform"]);
    } finally {
      c.restore();
    }
    expect(c.lines).toEqual([]);
  });

  it("caps one absurdly long part so a line cannot run away", () => {
    process.env["PIPELINE_TRACE"] = "1";
    const c = captureLogs();
    try {
      traceItem(["x".repeat(500)]);
    } finally {
      c.restore();
    }
    expect(c.lines[0]!.length).toBeLessThan(120);
  });

  it("survives a console that throws", () => {
    process.env["PIPELINE_TRACE"] = "1";
    console.log = () => {
      throw new Error("log sink down");
    };
    // Observability must never be the thing that fails a batch.
    expect(() => traceItem(["a", "b"])).not.toThrow();
    expect(() => traceFailure(["a", "b"])).not.toThrow();
    expect(() => traceStage("s", "d")).not.toThrow();
  });
});

describe("traceStage", () => {
  it("only speaks at verbose", () => {
    process.env["PIPELINE_TRACE"] = "1";
    const quiet = captureLogs();
    try {
      traceStage("gate", "escalated");
    } finally {
      quiet.restore();
    }
    expect(quiet.lines).toEqual([]);

    process.env["PIPELINE_TRACE"] = "verbose";
    const loud = captureLogs();
    try {
      traceStage("gate", "escalated");
    } finally {
      loud.restore();
    }
    expect(loud.lines).toEqual(["[pipeline] gate · escalated"]);
  });
});

describe("traceFailure", () => {
  it("is logged even when tracing is off", () => {
    process.env["PIPELINE_TRACE"] = "0";
    const c = captureLogs();
    try {
      traceFailure(["2/5", "UKRInform", "FAILED: rate limited"]);
    } finally {
      c.restore();
    }
    expect(c.lines).toEqual(["[pipeline] 2/5 · UKRInform · FAILED: rate limited"]);
  });
});

// ---------------------------------------------------------------- integration

/** Minimal repository holding pending dispatches, as the queue sees them. */
function repo(rows: { id: string; text: string; sourceName: string; url: string }[]) {
  const docs = rows.map((r) => ({
    ...r,
    status: "pending" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    attempts: 0,
  }));
  return {
    list: () => docs,
    pending: () => docs.filter((d) => d.status === "pending"),
    update: (id: string, patch: Record<string, unknown>) => {
      const i = docs.findIndex((d) => d.id === id);
      if (i >= 0) docs[i] = { ...docs[i]!, ...patch };
    },
  } as unknown as DispatchRepository;
}

const drone = () => ({
  id: "d1",
  name: "Shahed-136",
  aliases: [],
  operators: [],
  specs: [],
  rfBands: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const stubDeps = (over: Partial<PipelineDeps> = {}): PipelineDeps =>
  ({
    tier1: {
      tier: 1 as const,
      label: "t1",
      extract: async () => ({
        name: "Shahed-136",
        aliases: [],
        operators: [],
        rfBands: [],
        confidence: 0.4,
        specs: [],
        systems: [],
      }),
    },
    tier2: {
      tier: 2 as const,
      label: "t2",
      extract: async () => ({
        name: "Shahed-136",
        aliases: [],
        operators: [],
        rfBands: [],
        matchId: "d1",
        systems: [{ name: "Shahed-136", matchId: "d1" }],
        confidence: 0.92,
        specs: [
          { key: "range", label: "Range", value: 300, unit: "km" },
          { key: "speed", label: "Speed", value: 180, unit: "km/h" },
        ],
        metadata: { schemaVersion: 1, engine: "ai", model: "test-model", analyzedAt: "" },
      }),
    },
    drones: {
      list: () => [drone()],
      get: (id: string) => (id === "d1" ? drone() : undefined),
      upsert: () => {},
    },
    candidates: { add: () => {}, update: () => {}, list: () => [] },
    escalationThreshold: 0.8,
    autoMergeThreshold: 0.7,
    ...over,
  }) as unknown as PipelineDeps;

const RELEVANT = "A Shahed-136 drone was launched overnight near Odesa.";

describe("per-item trace through the queue", () => {
  it("reports engine, what was found, and what was written", async () => {
    process.env["PIPELINE_TRACE"] = "1";
    const c = captureLogs();
    try {
      await processPending(
        repo([{ id: "a", text: RELEVANT, sourceName: "UKRInform", url: "https://u.example/a" }]),
        stubDeps(),
        5,
      );
    } finally {
      c.restore();
    }

    const line = c.lines.find((l) => l.includes("UKRInform"))!;
    expect(line).toBeDefined();
    expect(line).toContain("1/1");
    expect(line).toContain("engine=t1+t2");
    expect(line).toContain("model=test-model");
    expect(line).toContain("conf=92%");
    expect(line).toContain("found 1 system, 2 specs");
    expect(line).toContain('merged into "Shahed-136"');
    expect(line).toContain("left=0");
  });

  it("names the heuristic engine when only the deterministic pass ran", async () => {
    process.env["PIPELINE_TRACE"] = "1";
    const heuristic: IntelExtractor = {
      tier: 1,
      label: "heuristic",
      extract: async () => ({
        name: "Shahed-136",
        aliases: [],
        operators: [],
        rfBands: [],
        confidence: 0.95,
        rationale: "test",
        specs: [],
        systems: [],
      }),
    };
    const c = captureLogs();
    try {
      await processPending(
        repo([{ id: "a", text: RELEVANT, sourceName: "Feed", url: "https://u.example/a" }]),
        stubDeps({ tier1: heuristic, tier2: heuristic, heuristic }),
        5,
      );
    } finally {
      c.restore();
    }
    expect(c.lines.some((l) => l.includes("engine=heuristic"))).toBe(true);
  });

  it("traces a post the pre-filter skipped, so it is not a silent gap", async () => {
    process.env["PIPELINE_TRACE"] = "1";
    const c = captureLogs();
    try {
      await processPending(
        repo([
          {
            id: "a",
            text: "Weather report: mild and sunny.",
            sourceName: "Al Jazeera",
            url: "https://u.example/a",
          },
        ]),
        stubDeps(),
        5,
      );
    } finally {
      c.restore();
    }
    const line = c.lines.find((l) => l.includes("Al Jazeera"))!;
    expect(line).toContain("engine=pre-filter");
    expect(line).toContain("skipped (no drone signal)");
  });

  it("adds the excerpt only at verbose", async () => {
    const run = async (level: string) => {
      process.env["PIPELINE_TRACE"] = level;
      const c = captureLogs();
      try {
        await processPending(
          repo([{ id: "a", text: RELEVANT, sourceName: "Feed", url: "https://u.example/a" }]),
          stubDeps(),
          5,
        );
      } finally {
        c.restore();
      }
      return c.lines.find((l) => l.includes("Feed"))!;
    };
    expect(await run("1")).not.toContain("excerpt=");
    expect(await run("verbose")).toContain("excerpt=");
  });

  it("traces a failing post even at level 0", async () => {
    process.env["PIPELINE_TRACE"] = "0";
    const boom: IntelExtractor = {
      tier: 1,
      label: "t1",
      extract: async () => {
        throw new Error("model returned nothing usable");
      },
    };
    const c = captureLogs();
    try {
      await processPending(
        repo([{ id: "a", text: RELEVANT, sourceName: "Feed", url: "https://u.example/a" }]),
        stubDeps({ tier1: boom, tier2: boom }),
        5,
      );
    } finally {
      c.restore();
    }
    expect(c.lines.some((l) => l.includes("FAILED: model returned nothing usable"))).toBe(true);
  });
});
