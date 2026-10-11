import { describe, expect, it, vi } from "vitest";
import { runTwoTier } from "@/features/intake/pipeline";
import type { Drone, Extraction, Candidate } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { PipelineDeps } from "@/features/intake/pipeline";

/**
 * The quick-paste control.
 *
 * Without it, tier 2 is reached only when needsDeepAI() fires - low combined confidence,
 * unresolved multi-system attribution, or conflicting identity. That is the right default for
 * bulk ingest, where most posts are short and the budget is shared. It is the wrong default for
 * an analyst pasting one report by hand, which is what this page is for.
 *
 * So `forceDeepAnalysis` exists, and these pin that the intake page can actually reach it: a
 * confident-looking tier-1 result must still escalate when the analyst asks.
 */

const drone = (id: string): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "IR",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

/** A tier-1 extraction good enough that no automatic gate would escalate it. */
const confident = (): Extraction => ({
  name: "Shahed-136",
  aliases: [],
  operators: [],
  specs: [{ key: "range", label: "Range", value: 2000, unit: "km" }],
  rfBands: [],
  systems: [{ name: "Shahed-136", matchId: "shahed-136" }],
  matchId: "shahed-136",
  // Above the default escalation threshold, and a single unambiguous system, so needsDeepAI
  // reports nothing needed.
  confidence: 0.92,
  rationale: "test",
});

function deps(over: Partial<PipelineDeps> = {}) {
  const items: Drone[] = [drone("shahed-136")];
  const cands: Candidate[] = [];
  const calls: number[] = [];
  const track = (tier: 1 | 2): IntelExtractor => ({
    tier,
    label: `tier${tier}`,
    extract: async () => {
      calls.push(tier);
      return confident();
    },
  });
  const heuristic: IntelExtractor = { ...track(1), label: "heuristic" };
  const tier1 = track(1);
  const tier2 = track(2);
  return {
    deps: {
      // heuristicFirst off, so the tier-1 result is the one the gates judge and there is no
      // ambiguity about which call produced the confidence.
      heuristicFirst: false,
      tier1,
      tier2,
      heuristic,
      fallback: heuristic,
      drones: {
        list: () => items,
        get: (id) => items.find((d) => d.id === id),
        upsert: (d) => {
          const i = items.findIndex((x) => x.id === d.id);
          if (i >= 0) items[i] = d;
          else items.push(d);
        },
        remove: (id) => {
          const i = items.findIndex((x) => x.id === id);
          if (i >= 0) items.splice(i, 1);
        },
        search: () => items,
      },
      candidates: { list: () => cands, add: (c) => cands.push(c), update: () => {} },
      escalationThreshold: 0.6,
      autoMergeThreshold: 0.85,
      ...over,
    } as PipelineDeps,
    calls,
  };
}

describe("forceDeepAnalysis", () => {
  it("stays on tier 1 when nothing requested it and the gates are satisfied", async () => {
    const { deps: d, calls } = deps();
    const r = await runTwoTier("a report", "Analyst paste", d);

    expect(calls).toEqual([1]);
    expect(r.candidate.tier).toBe(1);
  });

  it("runs tier 2 when the analyst asks, even with a confident tier-1 result", async () => {
    // forceDeepAnalysis is a PipelineDeps field, which is how the intake page passes it.
    const { deps: d, calls } = deps({ forceDeepAnalysis: true });
    const r = await runTwoTier("a report", "Analyst paste", d);

    expect(calls).toEqual([1, 2]);
    expect(r.candidate.tier).toBe(2);
  });

  it("records why it escalated, so a forced run is not mistaken for a gate", async () => {
    const { deps: d } = deps({ forceDeepAnalysis: true });
    const r = await runTwoTier("a report", "Analyst paste", d);

    expect(r.candidate.extraction.metadata?.escalationReasons).toContain(
      "analyst-requested-deep-analysis",
    );
  });

  it("still lands a merge, so forcing the tier changes cost rather than outcome", async () => {
    const { deps: d } = deps({ forceDeepAnalysis: true });
    const r = await runTwoTier("a report", "Analyst paste", d);

    if (r.kind !== "auto-merged") throw new Error(`expected a merge, got ${r.kind}`);
    expect(r.droneId).toBe("shahed-136");
  });
});

vi.mock("@/shared/infra/services", () => ({}));
void vi;
