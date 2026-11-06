import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import { distinctiveWords, splitSuggestion } from "@/entities/drone/variant-split";
import type { AliasClaim, Drone, SpecClaim } from "@/entities/drone/types";
import type { DroneRepository } from "@/shared/contracts/repository";
import { splitVariant, undoSpecClaimToSystem } from "@/shared/infra/catalog-operations";

const AT = "2026-11-06T12:00:00.000Z";

const alias = (alias: string, id: string): AliasClaim =>
  ({ id, alias, status: "verified", firstSeen: AT }) as AliasClaim;

const claim = (id: string, value: number, evidence: string): SpecClaim => ({
  id,
  value,
  source: "Defense Express",
  date: AT,
  evidence,
  normalized: { raw: `${value} km`, canonicalValue: value, canonicalUnit: "km", confidence: 1 },
});

const pac3 = (): Drone => ({
  id: "pac-3-3f04",
  name: "PAC-3",
  aliases: ["PAC-3 MSE", "MIM-104F MSE", "Patriot PAC-3"],
  aliasClaims: [
    alias("PAC-3 MSE", "alias-pak3mse"),
    alias("MIM-104F MSE", "alias-mim104fms"),
    alias("Patriot PAC-3", "alias-patriotpak3"),
  ],
  domain: "Air",
  origin: "US",
  manufacturer: "Lockheed Martin",
  operators: ["UA"],
  propulsion: "solid rocket motor",
  summary: "",
  specs: [
    {
      key: "max_altitude",
      label: "Maximum altitude",
      unit: "km",
      discoveredBy: "ai",
      claims: [
        claim("a1", 30, "PAC-3 MSE is reported to have a maximum interception altitude of 30 km"),
        claim("a2", 20, "The PAC-3 reaches 20 km"),
      ],
    },
  ],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: AT,
  updatedAt: AT,
});

function repo(initial: Drone[]) {
  const ds = [...initial];
  return {
    list: () => ds,
    get: (id: string) => ds.find((d) => d.id === id),
    upsert: (d: Drone) => {
      const i = ds.findIndex((x) => x.id === d.id);
      if (i >= 0) ds[i] = d;
      else ds.push(d);
    },
    remove: () => {},
    search: () => ds,
  } as DroneRepository;
}

describe("splitting a variant out of an entry", () => {
  it("finds the words that set the variant's name apart", () => {
    expect(distinctiveWords("PAC-3 MSE", "PAC-3")).toEqual(["mse"]);
    expect(distinctiveWords("Patriot PAC-3", "PAC-3")).toEqual(["patriot"]);
    expect(distinctiveWords("pac 3", "PAC-3")).toEqual([]);
  });

  it("suggests the aliases and claims that name the variant, and nothing that names the parent", () => {
    const s = splitSuggestion(pac3(), "alias-pak3mse");
    expect(s.aliasIds).toEqual(["alias-pak3mse", "alias-mim104fms"]);
    expect(s.claims.map((c) => c.claim.id)).toEqual(["a1"]);
  });

  it("creates the variant, moves what was picked onto it and links it to its parent", () => {
    const drones = repo([pac3()]);
    const s = splitSuggestion(drones.get("pac-3-3f04")!, "alias-pak3mse");
    const created = splitVariant("pac-3-3f04", s.aliasIds, s.claims, { drones }, AT)!;

    expect(created.name).toBe("PAC-3 MSE");
    expect(created.id).toMatch(/^pac-3-mse-[0-9a-f]{4}$/);
    expect(created.origin).toBe("US");
    expect(created.operators).toEqual([]);
    expect(created.aliases).toContain("MIM-104F MSE");
    expect(created.relations?.find((r) => r.kind === "variant_of")?.targetSystemId).toBe(
      "pac-3-3f04",
    );
    expect(consensus(created.specs[0]!).median).toBe(30);

    const parent = drones.get("pac-3-3f04")!;
    expect(parent.aliases).not.toContain("PAC-3 MSE");
    expect(parent.aliases).toContain("Patriot PAC-3");
    // The moved claim stays on the parent as moved evidence and stops counting there.
    const moved = parent.specs[0]!.claims.find((c) => c.id === "a1")!;
    expect(moved.review?.movedToDroneId).toBe(created.id);
    expect(consensus(parent.specs[0]!).median).toBe(20);
  });

  it("lets a claim moved by mistake be returned the ordinary way", () => {
    const drones = repo([pac3()]);
    const s = splitSuggestion(drones.get("pac-3-3f04")!, "alias-pak3mse");
    const created = splitVariant("pac-3-3f04", s.aliasIds, s.claims, { drones }, AT)!;
    const moved = drones.get("pac-3-3f04")!.specs[0]!.claims.find((c) => c.id === "a1")!;
    undoSpecClaimToSystem("pac-3-3f04", "max_altitude", moved, { drones }, AT);
    expect(drones.get(created.id)!.specs[0]!.claims).toEqual([]);
    expect(drones.get("pac-3-3f04")!.specs[0]!.claims.find((c) => c.id === "a1")!.review).toBe(
      undefined,
    );
  });

  it("refuses an alias the entry does not have", () => {
    const drones = repo([pac3()]);
    expect(splitVariant("pac-3-3f04", ["alias-none"], [], { drones }, AT)).toBeUndefined();
    expect(drones.list()).toHaveLength(1);
  });
});
