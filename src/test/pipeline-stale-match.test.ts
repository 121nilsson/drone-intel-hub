import { describe, expect, it } from "vitest";
import { runTwoTier, type PipelineDeps } from "@/features/intake/pipeline";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const SRC = "test-source";

const makeDrone = (id: string, name: string): Drone => ({
  id,
  name,
  aliases: [],
  domain: "Multi",
  origin: "IR",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const repo = (seed: Drone[] = []) => {
  const items: Drone[] = [...seed];
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
  tier2?: IntelExtractor;
  autoPromoteThreshold?: number;
  seed?: Drone[];
}) {
  const d = repo(over.seed);
  const cands: Candidate[] = [];
  const deps: PipelineDeps & { cands: Candidate[] } = {
    drones: d,
    candidates: { list: () => cands, add: (c) => cands.push(c), update: () => {} },
    tier1: over.tier1,
    tier2: over.tier2 ?? ok({}),
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    ...(over.autoPromoteThreshold !== undefined
      ? { autoPromoteThreshold: over.autoPromoteThreshold }
      : {}),
    cands,
  };
  return deps;
}

describe("stale matchId handling", () => {
  it("falls through to the queue instead of throwing when the matched drone no longer exists", async () => {
    // The extractor returned a matchId for a catalog entry that a concurrent analyst merge
    // has since removed. Throwing would burn the dispatch's retry budget (and eventually
    // mark it "failed") for a transient state, so the pipeline must degrade gracefully.
    const d = makeDeps({
      tier1: ok({ matchId: "ghost-drone", name: "New Drone", confidence: 0.9 }),
      seed: [],
    });
    const res = await runTwoTier("New drone observed with a jammer payload.", SRC, d);
    expect(res.kind).toBe("queued");
    expect(res.candidate.extraction.matchId).toBeUndefined();
  });

  it("keeps a valid matchId untouched when the target still exists", async () => {
    const seed = [makeDrone("lancet-3", "Lancet-3")];
    const d = makeDeps({
      tier1: ok({ matchId: "lancet-3", name: "Lancet-3", confidence: 0.9 }),
      seed,
    });
    const res = await runTwoTier("Lancet-3 drone strike reported.", SRC, d);
    expect(res.kind).toBe("auto-merged");
    expect(res.candidate.extraction.matchId).toBe("lancet-3");
  });
});

describe("catalog collision check", () => {
  it("does not auto-promote a name that collides with the catalog modulo punctuation", async () => {
    // "Shahed 136" and "Shahed-136" are the same system to a source document. The old
    // exact-match check missed this and auto-promotion created a duplicate entry.
    const d = makeDeps({
      tier1: ok({ name: "Shahed 136", confidence: 0.9 }),
      autoPromoteThreshold: 0.8,
      seed: [makeDrone("shahed-136", "Shahed-136")],
    });
    const res = await runTwoTier("Shahed 136 drone launched overnight.", SRC, d);
    expect(res.kind).toBe("queued");
    expect(d.drones.list()).toHaveLength(1);
  });

  it("still auto-promotes a genuinely new name", async () => {
    // Positive control: the stricter collision key must not block real new systems.
    const d = makeDeps({
      tier1: ok({ name: "Novator T-10", confidence: 0.9 }),
      autoPromoteThreshold: 0.8,
      seed: [makeDrone("shahed-136", "Shahed-136")],
    });
    const res = await runTwoTier("Novator T-10 drone observed on video.", SRC, d);
    expect(res.kind).toBe("auto-promoted");
    expect(d.drones.list()).toHaveLength(2);
  });
});
