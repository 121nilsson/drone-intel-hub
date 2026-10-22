import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import { ensureClaimIds } from "@/entities/drone/claim-review";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import type { DroneRepository } from "@/shared/contracts/repository";
import { moveSpecClaimToSystem, undoSpecClaimToSystem } from "@/shared/infra/catalog-operations";

const AT = "2026-10-20T12:00:00.000Z";

const claim = (value: number, source: string, over: Partial<SpecClaim> = {}): SpecClaim => ({
  value,
  source,
  date: "2026-10-01T00:00:00.000Z",
  normalized: { raw: `${value} km`, canonicalValue: value, canonicalUnit: "km", confidence: 1 },
  ...over,
});

const spec = (key: string, label: string, unit: string, claims: SpecClaim[]): SpecAttribute => ({
  key,
  label,
  unit,
  discoveredBy: "ai",
  claims,
});

const drone = (id: string, name: string, specs: SpecAttribute[]): Drone => ({
  id,
  name,
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

function repo(initial: Drone[]) {
  const ds = [...initial];
  let writes = 0;
  const drones = {
    list: () => ds,
    get: (id: string) => ds.find((d) => d.id === id),
    upsert: (d: Drone) => {
      writes++;
      const i = ds.findIndex((x) => x.id === d.id);
      if (i >= 0) ds[i] = d;
      else ds.push(d);
    },
    remove: () => {},
    search: () => ds,
  } as DroneRepository;
  return { drones, all: () => ds, writes: () => writes };
}

describe("moving a claim to another system", () => {
  const sourceClaim = claim(600, "sUAS News", {
    id: "claim-1",
    raw: "altitude and 600 kilometers",
    evidence: "the altitude reached 600 kilometers",
  });
  const source = () =>
    drone("lancet-3", "Lancet-3", [spec("altitude", "Maximum altitude", "km", [sourceClaim])]);
  const target = () =>
    drone("shahed-136", "Shahed-136", [spec("speed", "Cruise speed", "km/h", [])]);

  it("keeps the source claim as rejected evidence and files a confirmed claim on the target", () => {
    const { drones, all } = repo([source(), target()]);
    const out = moveSpecClaimToSystem(
      "lancet-3",
      "altitude",
      sourceClaim,
      "shahed-136",
      "speed",
      "600 km/h",
      { drones },
      AT,
    );
    expect(out).toBeDefined();
    const [from, to] = all();
    expect(from!.specs[0]!.claims[0]!.review).toEqual({
      verdict: "rejected",
      issue: "system",
      movedTo: "speed",
      movedToDroneId: "shahed-136",
      moveId: expect.any(String),
      at: AT,
      by: "analyst",
    });
    expect(consensus(from!.specs[0]!)).toMatchObject({ display: "—", sources: 0 });
    expect(to!.specs[0]!.claims).toHaveLength(1);
    expect(to!.specs[0]!.claims[0]).toMatchObject({
      source: "sUAS News",
      value: 600,
      raw: "600 km/h",
      movedFrom: "claim-1",
      movedFromDroneId: "lancet-3",
      movedFromMoveId: expect.any(String),
      extractionEngine: "analyst",
      review: { verdict: "confirmed", by: "analyst" },
    });
    expect(consensus(to!.specs[0]!)).toMatchObject({ display: "600 km/h", sources: 1 });
  });

  it("does not file a second copy when the operation is retried", () => {
    const { drones, all, writes } = repo([source(), target()]);
    moveSpecClaimToSystem(
      "lancet-3",
      "altitude",
      sourceClaim,
      "shahed-136",
      "speed",
      "600 km/h",
      { drones },
      AT,
    );
    const afterFirst = writes();
    moveSpecClaimToSystem(
      "lancet-3",
      "altitude",
      sourceClaim,
      "shahed-136",
      "speed",
      "600 km/h",
      { drones },
      AT,
    );
    expect(all()[1]!.specs[0]!.claims).toHaveLength(1);
    expect(writes()).toBe(afterFirst);
  });

  it("undoes both halves of the move", () => {
    const { drones, all } = repo([source(), target()]);
    moveSpecClaimToSystem(
      "lancet-3",
      "altitude",
      sourceClaim,
      "shahed-136",
      "speed",
      "600 km/h",
      { drones },
      AT,
    );

    undoSpecClaimToSystem("lancet-3", "altitude", sourceClaim, { drones }, AT);
    const [from, to] = all();
    expect(from!.specs[0]!.claims[0]!.review).toBeUndefined();
    expect(consensus(from!.specs[0]!)).toMatchObject({ display: "600 km", sources: 1 });
    expect(to!.specs[0]!.claims).toHaveLength(0);
  });

  it("undoes after a re-analysis recreates the source claim with a new id", () => {
    const { drones, all } = repo([source(), target()]);
    moveSpecClaimToSystem(
      "lancet-3",
      "altitude",
      sourceClaim,
      "shahed-136",
      "speed",
      "600 km/h",
      { drones },
      AT,
    );
    const [, movedTarget] = all();
    const review = all()[0]!.specs[0]!.claims[0]!.review!;

    // A re-run retracts the post's claims and re-creates them, so the source id changes. The
    // held verdict comes back with the move id that filed the target copy.
    const reanalysedClaim = claim(600, "sUAS News", {
      id: "claim-2",
      raw: "altitude and 600 kilometers",
      evidence: "the altitude reached 600 kilometers",
      review,
    });
    const reanalysed = drone("lancet-3", "Lancet-3", [
      spec("altitude", "Maximum altitude", "km", [reanalysedClaim]),
    ]);
    const later = repo([reanalysed, movedTarget!]);
    undoSpecClaimToSystem("lancet-3", "altitude", reanalysedClaim, { drones: later.drones }, AT);
    expect(later.all()[0]!.specs[0]!.claims[0]!.review).toBeUndefined();
    expect(later.all()[1]!.specs[0]!.claims).toHaveLength(0);
  });

  it("writes nothing when the source claim or the target attribute is gone", () => {
    const { drones, writes } = repo([source(), target()]);
    expect(
      moveSpecClaimToSystem(
        "lancet-3",
        "altitude",
        claim(1, "Other"),
        "shahed-136",
        "speed",
        "",
        { drones },
        AT,
      ),
    ).toBeUndefined();
    expect(
      moveSpecClaimToSystem(
        "lancet-3",
        "altitude",
        sourceClaim,
        "shahed-136",
        "range",
        "",
        { drones },
        AT,
      ),
    ).toBeUndefined();
    expect(
      moveSpecClaimToSystem(
        "lancet-3",
        "altitude",
        sourceClaim,
        "lancet-3",
        "speed",
        "",
        { drones },
        AT,
      ),
    ).toBeUndefined();
    expect(writes()).toBe(0);
  });
});

describe("stable claim identities", () => {
  it("gives identical legacy claims different ids and leaves an identified catalog alone", () => {
    const same = { value: 40, source: "Rybar", date: "2026-10-01T00:00:00.000Z" };
    const legacy = drone("legacy", "Legacy", [spec("range", "Range", "km", [same, { ...same }])]);
    const withIds = ensureClaimIds(legacy);
    const ids = withIds.specs[0]!.claims.map((c) => c.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(ensureClaimIds(withIds)).toBe(withIds);
  });
});
