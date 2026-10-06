import { describe, expect, it } from "vitest";
import { runTwoTier, promote, type PipelineDeps } from "@/features/intake/pipeline";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const drone = (id: string, over: Partial<Drone> = {}): Drone => ({
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
  ...over,
});

/** Repository stubs that mimic the write-through behaviour the real ones have. */
function repo(seed: Drone[]) {
  let items = [...seed];
  return {
    list: () => items,
    get: (id: string) => items.find((d) => d.id === id),
    upsert: (d: Drone) => {
      const i = items.findIndex((x) => x.id === d.id);
      items = i >= 0 ? items.map((x) => (x.id === d.id ? d : x)) : [...items, d];
    },
    search: () => items,
    _all: () => items,
  };
}

const extractor = (e: Partial<Extraction>): IntelExtractor => ({
  tier: 1,
  label: "test",
  extract: async () =>
    ({
      aliases: [],
      operators: [],
      specs: [],
      rfBands: [],
      confidence: 0.95,
      rationale: "test",
      ...e,
    }) as Extraction,
});

function deps(
  drones: Drone[],
  extraction: Partial<Extraction>,
): PipelineDeps & { _cands: Candidate[] } {
  const d = repo(drones);
  const cands: Candidate[] = [];
  return {
    drones: d,
    candidates: { list: () => cands, add: (c) => cands.push(c), update: () => {} },
    tier1: extractor(extraction),
    tier2: extractor(extraction),
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    _cands: cands,
  };
}

const SRC = "test-source";

describe("runTwoTier relation persistence", () => {
  it("persists systems[] as symmetric counterpart links on auto-merge", async () => {
    const d = deps([drone("shahed-136"), drone("geran-2"), drone("gweepard")], {
      matchId: "shahed-136",
      systems: [
        { name: "Geran-2", matchId: "geran-2" },
        { name: "Gepard AA", matchId: "gweepard" },
      ],
    });

    const res = await runTwoTier("report text", SRC, d);
    expect(res.kind).toBe("auto-merged");

    const shahed = d.drones.get("shahed-136")!;
    expect(shahed.counterpartIds.sort()).toEqual(["geran-2", "gweepard"]);
    // Reciprocal edges, so the graph is traversable from either end.
    expect(d.drones.get("geran-2")?.counterpartIds).toContain("shahed-136");
    expect(d.drones.get("gweepard")?.counterpartIds).toContain("shahed-136");
  });

  it("persists a variantOf edge", async () => {
    const d = deps([drone("shahed-136"), drone("shahed-236")], {
      matchId: "shahed-236",
      systems: [{ name: "Shahed-236", variantOf: "shahed-136" }],
    });
    await runTwoTier("report", SRC, d);
    expect(d.drones.get("shahed-236")?.counterpartIds).toContain("shahed-136");
    expect(d.drones.get("shahed-136")?.counterpartIds).toContain("shahed-236");
  });

  it("still merges specs when the extraction reports no systems", async () => {
    const d = deps([drone("shahed-136")], {
      matchId: "shahed-136",
      specs: [{ key: "range", label: "Range", value: 2000, unit: "km" }],
    });
    const res = await runTwoTier("report", SRC, d);
    expect(res.kind).toBe("auto-merged");
    expect(d.drones.get("shahed-136")?.specs.map((s) => s.key)).toContain("range");
    expect(d.drones.get("shahed-136")?.counterpartIds).toEqual([]);
  });

  it("does not link when the candidate is only queued, not merged", async () => {
    const d = deps([drone("shahed-136"), drone("geran-2")], {
      matchId: "geran-2",
      confidence: 0.2,
      systems: [{ name: "Shahed-136", matchId: "shahed-136" }],
    });
    const res = await runTwoTier("report", SRC, d);
    expect(res.kind).toBe("queued");
    expect(d.drones.get("geran-2")?.counterpartIds).toEqual([]);
  });

  it("does not create a self-link when the report only names the target", async () => {
    const d = deps([drone("shahed-136")], {
      matchId: "shahed-136",
      systems: [{ name: "Shahed-136", matchId: "shahed-136" }],
    });
    await runTwoTier("report", SRC, d);
    expect(d.drones.get("shahed-136")?.counterpartIds).toEqual([]);
  });

  it("accumulates links across multiple reports and stays idempotent", async () => {
    const d = deps([drone("shahed-136"), drone("geran-2"), drone("gweepard")], {
      matchId: "shahed-136",
      systems: [{ name: "Geran-2", matchId: "geran-2" }],
    });
    await runTwoTier("a", SRC, d);
    d.tier1 = extractor({
      matchId: "shahed-136",
      systems: [{ name: "Gepard AA", matchId: "gweepard" }],
    });
    d.tier2 = d.tier1;
    await runTwoTier("b", SRC, d);
    expect(d.drones.get("shahed-136")?.counterpartIds.sort()).toEqual(["geran-2", "gweepard"]);

    const before = JSON.stringify(d.drones.get("shahed-136")?.counterpartIds);
    d.tier1 = extractor({
      matchId: "shahed-136",
      systems: [{ name: "Geran-2", matchId: "geran-2" }],
    });
    d.tier2 = d.tier1;
    await runTwoTier("c", SRC, d);
    expect(JSON.stringify(d.drones.get("shahed-136")?.counterpartIds)).toBe(before);
  });
});

describe("promote relation persistence", () => {
  it("seeds relations from systems[] when a candidate is promoted", () => {
    const d = deps([drone("geran-2")], {});
    const candidate: Candidate = {
      id: "abcd1234",
      raw: "New interceptor spotted alongside Geran-2",
      source: SRC,
      createdAt: "2026-10-06T00:00:00.000Z",
      tier: 1,
      status: "pending",
      extraction: {
        aliases: [],
        operators: [],
        specs: [],
        rfBands: [],
        confidence: 0.4,
        rationale: "test",
        name: "Orlan-10",
        systems: [{ name: "Geran-2", matchId: "geran-2" }],
      },
    };

    const created = promote(candidate, { drones: d.drones, candidates: d.candidates });
    expect(created.name).toBe("Orlan-10");
    expect(created.counterpartIds).toEqual(["geran-2"]);
    // Reciprocal edge added to the existing catalog entry.
    expect(d.drones.get("geran-2")?.counterpartIds).toContain(created.id);
  });
});
