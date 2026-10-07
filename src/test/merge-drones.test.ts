import { describe, expect, it } from "vitest";
import { mergeDrones } from "@/features/intake/pipeline";
import type { Candidate, Drone, SpecAttribute } from "@/entities/drone/types";

const makeDrone = (id: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "IR",
  operators: ["RU"],
  propulsion: "Piston (MD-550)",
  summary: "Sample drone summary",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function createMockRepo(seed: Drone[]) {
  let items = [...seed];
  return {
    list: () => items,
    get: (id: string) => items.find((d) => d.id === id),
    upsert: (d: Drone) => {
      const i = items.findIndex((x) => x.id === d.id);
      items = i >= 0 ? items.map((x) => (x.id === d.id ? d : x)) : [...items, d];
    },
    remove: (id: string) => {
      items = items.filter((x) => x.id !== id);
    },
    search: () => items,
  };
}

describe("mergeDrones", () => {
  it("merges two duplicate drones, preserving distinct specs, RF links, and components", () => {
    const spec1: SpecAttribute = {
      key: "speed",
      label: "Speed",
      unit: "km/h",
      discoveredBy: "seed",
      claims: [{ value: 180, source: "Source A", date: "2026-01-01" }],
    };
    const spec2: SpecAttribute = {
      key: "speed",
      label: "Speed",
      unit: "km/h",
      discoveredBy: "ai",
      claims: [{ value: 190, source: "Source B", date: "2026-01-02" }],
    };
    const specRange: SpecAttribute = {
      key: "range",
      label: "Range",
      unit: "km",
      discoveredBy: "ai",
      claims: [{ value: 2000, source: "Source C", date: "2026-01-03" }],
    };

    const droneA = makeDrone("geran-2", {
      name: "Geran-2",
      aliases: ["Shahed-136"],
      specs: [spec1],
      rf: [{ role: "uplink", band: "868 MHz" }],
      components: [{ part: "Engine", manufacturer: "MD550", origin: "IR" }],
      evolution: [{ date: "2026-01-01", kind: "other", description: "Created", source: "A" }],
      counterpartIds: ["lyutyi"],
    });

    const droneB = makeDrone("geran-2-dup", {
      name: "Geran-2",
      cyrillic: "Герань-2",
      aliases: ["Moped"],
      specs: [spec2, specRange],
      rf: [
        { role: "uplink", band: "868 MHz" }, // Duplicate RF band
        { role: "gnss", band: "CRPA" },
      ],
      components: [{ part: "CRPA", manufacturer: "Kometa", origin: "RU" }],
      evolution: [{ date: "2026-01-02", kind: "payload", description: "Warhead upgrade", source: "B" }],
      counterpartIds: ["warmate"],
    });

    const thirdDrone = makeDrone("third-drone", {
      counterpartIds: ["geran-2-dup"],
    });

    const dronesRepo = createMockRepo([droneA, droneB, thirdDrone]);
    const candidates: Candidate[] = [
      {
        id: "cand-1",
        raw: "report",
        source: "feed",
        createdAt: "2026-01-01",
        tier: 1,
        status: "merged",
        resolvedInto: "geran-2-dup",
        extraction: { aliases: [], operators: [], specs: [], rfBands: [], confidence: 1, rationale: "" },
      },
    ];
    const candidateRepo = {
      list: () => candidates,
      add: (c: Candidate) => candidates.push(c),
      update: (id: string, patch: Partial<Candidate>) => {
        const item = candidates.find((c) => c.id === id);
        if (item) Object.assign(item, patch);
      },
    };

    const merged = mergeDrones("geran-2", "geran-2-dup", { drones: dronesRepo, candidates: candidateRepo });

    expect(merged).toBeDefined();
    expect(merged?.id).toBe("geran-2");
    expect(merged?.cyrillic).toBe("Герань-2");
    expect(merged?.aliases).toEqual(expect.arrayContaining(["Shahed-136", "Moped"]));

    // Specs: combined speed claims + range
    const speedSpec = merged?.specs.find((s) => s.key === "speed");
    expect(speedSpec?.claims).toHaveLength(2);
    expect(speedSpec?.claims.map((c) => c.value)).toEqual([180, 190]);
    expect(merged?.specs.find((s) => s.key === "range")?.claims[0]?.value).toBe(2000);

    // RF links: merged without duplicates
    expect(merged?.rf).toHaveLength(2);
    expect(merged?.rf.map((r) => r.band)).toEqual(["868 MHz", "CRPA"]);

    // Components
    expect(merged?.components).toHaveLength(2);

    // Counterparts: merged without referencing self or deleted id
    expect(merged?.counterpartIds).toEqual(expect.arrayContaining(["lyutyi", "warmate"]));
    expect(merged?.counterpartIds).not.toContain("geran-2-dup");
    expect(merged?.counterpartIds).not.toContain("geran-2");

    // Third drone's counterpart link updated from geran-2-dup to geran-2
    expect(dronesRepo.get("third-drone")?.counterpartIds).toEqual(["geran-2"]);

    // Candidate re-pointed to geran-2
    expect(candidates[0]?.resolvedInto).toBe("geran-2");

    // Old duplicate removed from repository
    expect(dronesRepo.get("geran-2-dup")).toBeUndefined();
    expect(dronesRepo.list().map((d) => d.id)).toEqual(["geran-2", "third-drone"]);
  });

  it("returns undefined if keepId and mergeId are identical or not found", () => {
    const drone = makeDrone("drone-1");
    const repo = createMockRepo([drone]);
    const candRepo = { list: () => [], add: () => {}, update: () => {} };

    expect(mergeDrones("drone-1", "drone-1", { drones: repo, candidates: candRepo })).toBeUndefined();
    expect(mergeDrones("drone-1", "nonexistent", { drones: repo, candidates: candRepo })).toBeUndefined();
  });
});
