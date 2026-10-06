import { describe, expect, it } from "vitest";
import { counterpartIdsFor, linkCounterparts, resolveSystemId } from "@/entities/drone/relations";
import type { Drone, Extraction } from "@/entities/drone/types";

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

const extraction = (systems: Extraction["systems"]): Extraction => ({
  aliases: [],
  operators: [],
  specs: [],
  rfBands: [],
  confidence: 0.9,
  rationale: "test",
  ...(systems ? { systems } : {}),
});

describe("resolveSystemId", () => {
  const catalog = [
    drone("shahed-136", { name: "Shahed-136", aliases: ["Geran-2"] }),
    drone("geran-2", { name: "Geran-2", cyrillic: "Герань-2" }),
  ];

  it("matches on exact name", () => {
    expect(resolveSystemId("Shahed-136", catalog)).toBe("shahed-136");
  });

  it("matches on alias", () => {
    expect(resolveSystemId("Geran-2", catalog)).toBe("geran-2");
  });

  it("matches on cyrillic name", () => {
    expect(resolveSystemId("Герань-2", catalog)).toBe("geran-2");
  });

  it("is case and diacritic insensitive", () => {
    expect(resolveSystemId("  SHAHED-136 ", catalog)).toBe("shahed-136");
  });

  it("returns undefined for an unknown system", () => {
    expect(resolveSystemId("Brand New Thing", catalog)).toBeUndefined();
  });

  it("returns undefined for an empty name", () => {
    expect(resolveSystemId("   ", catalog)).toBeUndefined();
  });

  it("tolerates a document with no aliases array", () => {
    // Schemaless JSONB means a hand-seeded or externally written doc can omit fields.
    const ragged = [drone("shahed-136", { aliases: undefined as never }), drone("geran-2")];
    expect(resolveSystemId("Geran-2", ragged)).toBe("geran-2");
    expect(resolveSystemId("Unknown", ragged)).toBeUndefined();
  });
});

describe("counterpartIdsFor", () => {
  const catalog = [drone("shahed-136"), drone("geran-2"), drone("gweepard")];

  it("collects explicit matchId edges", () => {
    const ids = counterpartIdsFor(
      extraction([
        { name: "Geran-2", matchId: "geran-2" },
        { name: "Gepard", matchId: "gweepard" },
      ]),
      catalog,
      "shahed-136",
    );
    expect(ids.sort()).toEqual(["geran-2", "gweepard"]);
  });

  it("collects variantOf edges", () => {
    expect(
      counterpartIdsFor(
        extraction([{ name: "Shahed-236", variantOf: "shahed-136" }]),
        catalog,
        "geran-2",
      ),
    ).toEqual(["shahed-136"]);
  });

  it("falls back to name resolution when no id is given", () => {
    expect(counterpartIdsFor(extraction([{ name: "Shahed-136" }]), catalog, "geran-2")).toEqual([
      "shahed-136",
    ]);
  });

  it("excludes the target itself", () => {
    expect(
      counterpartIdsFor(
        extraction([{ name: "Shahed-136", matchId: "shahed-136" }]),
        catalog,
        "shahed-136",
      ),
    ).toEqual([]);
  });

  it("ignores ids that are not in the catalog", () => {
    expect(
      counterpartIdsFor(
        extraction([{ name: "Ghost", matchId: "does-not-exist" }]),
        catalog,
        "shahed-136",
      ),
    ).toEqual([]);
  });

  it("deduplicates when both matchId and name resolve", () => {
    const ids = counterpartIdsFor(
      extraction([{ name: "Geran-2", matchId: "geran-2" }]),
      catalog,
      "shahed-136",
    );
    expect(ids).toEqual(["geran-2"]);
  });

  it("handles a missing systems array", () => {
    expect(counterpartIdsFor(extraction(undefined), catalog, "shahed-136")).toEqual([]);
  });
});

describe("linkCounterparts", () => {
  const catalog = [drone("shahed-136"), drone("geran-2"), drone("gweepard")];

  it("links both directions and returns changed drones", () => {
    const target = catalog[0]!;
    const changed = linkCounterparts(target, ["geran-2"], catalog);
    const byId = new Map(changed.map((d) => [d.id, d]));
    expect(byId.get("shahed-136")?.counterpartIds).toEqual(["geran-2"]);
    expect(byId.get("geran-2")?.counterpartIds).toEqual(["shahed-136"]);
  });

  it("preserves existing links", () => {
    const target = drone("shahed-136", { counterpartIds: ["warmate"] });
    const withTarget = [...catalog.slice(1), target];
    const changed = linkCounterparts(target, ["geran-2"], withTarget);
    expect(changed.find((d) => d.id === "shahed-136")?.counterpartIds).toEqual([
      "warmate",
      "geran-2",
    ]);
  });

  it("is idempotent", () => {
    const target = drone("shahed-136");
    const first = linkCounterparts(target, ["geran-2"], catalog);
    const next = [...catalog.slice(1), first.find((d) => d.id === "shahed-136")!];
    expect(linkCounterparts(next[0]!, ["geran-2"], next)).toEqual([]);
  });

  it("drops a self-link", () => {
    const target = drone("shahed-136");
    expect(linkCounterparts(target, ["shahed-136"], catalog)).toEqual([]);
  });

  it("ignores link ids absent from the catalog", () => {
    expect(linkCounterparts(drone("shahed-136"), ["nope"], catalog)).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const target = drone("shahed-136");
    const other = drone("geran-2");
    linkCounterparts(target, ["geran-2"], [target, other]);
    expect(target.counterpartIds).toEqual([]);
    expect(other.counterpartIds).toEqual([]);
  });
});
