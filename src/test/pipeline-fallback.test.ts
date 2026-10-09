import { describe, expect, it } from "vitest";
import { runTwoTier, type PipelineDeps } from "@/features/intake/pipeline";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const SRC = "test-source";

const repo = () => {
  const items: Drone[] = [];
  return {
    list: () => items,
    get: (id: string) => items.find((d) => d.id === id),
    remove: (id: string) => {
      const i = items.findIndex((d) => d.id === id);
      if (i >= 0) items.splice(i, 1);
    },
    search: () => items,
    upsert: (d: Drone) => {
      const i = items.findIndex((x) => x.id === d.id);
      if (i >= 0) items[i] = d;
      else items.push(d);
    },
  };
};

const failing = (msg: string): IntelExtractor => ({
  tier: 1,
  label: "failing",
  extract: async () => {
    throw new Error(msg);
  },
});

const ok = (e: Partial<Extraction>): IntelExtractor => ({
  tier: 1,
  label: "ok",
  extract: async () =>
    ({
      name: null,
      aliases: [],
      operators: [],
      specs: [],
      rfBands: [],
      systems: [],
      confidence: 0,
      rationale: "test",
      ...e,
    }) as Extraction,
});

function makeDeps(over: {
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  fallback?: IntelExtractor;
}) {
  const d = repo();
  const cands: Candidate[] = [];
  const deps: PipelineDeps & { cands: Candidate[] } = {
    drones: d,
    candidates: { list: () => cands, add: (c) => cands.push(c), update: () => {} },
    tier1: over.tier1,
    tier2: over.tier2,
    ...(over.fallback ? { fallback: over.fallback } : {}),
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    cands,
  };
  return deps;
}

describe("runTwoTier provider-outage fallback", () => {
  it("uses the heuristic engine when tier 1 throws, and marks the candidate degraded", async () => {
    const d = makeDeps({
      tier1: failing("provider down"),
      tier2: failing("provider down"),
      fallback: new HeuristicExtractor(1),
    });
    const res = await runTwoTier(
      "Russia launched an FPV drone with GPS jammers, cruising 120 km/h, range 40 km, 2 kg warhead at $300.",
      SRC,
      d,
    );
    expect(res.kind).toBe("queued");
    expect(res.candidate.tier).toBe(1);
    expect(res.candidate.extraction.rationale).toContain("heuristic");
    expect(d.cands).toHaveLength(1);
  });

  it("keeps the tier-1 result when tier 2 throws after escalation", async () => {
    const d = makeDeps({
      tier1: ok({
        name: "Zala-421",
        confidence: 0.4,
        systems: [{ name: "Zala-421" }],
      }),
      tier2: failing("Provider timeout"),
    });
    const res = await runTwoTier("Zala-421 loitering munition over Odesa.", SRC, d);
    expect(res.kind).toBe("queued");
    expect(res.candidate.tier).toBe(1);
    expect(res.candidate.extraction.name).toBe("Zala-421");
    expect(res.candidate.extraction.rationale).toContain("kept tier 1");
  });

  it("still hard-fails when no fallback engine is configured (test/legacy callers)", async () => {
    const d = makeDeps({
      tier1: failing("provider down"),
      tier2: failing("provider down"),
    });
    await expect(runTwoTier("text", SRC, d)).rejects.toThrow("provider down");
  });
});
