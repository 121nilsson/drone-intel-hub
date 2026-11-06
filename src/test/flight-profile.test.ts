import { describe, expect, it } from "vitest";
import { detectCorrection, plausibleBounds } from "@/entities/drone/auto-correction";
import { recheckDroneBounds, verifyClaim, verifyDrone } from "@/entities/drone/verification";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { normalizeQuantityLoose } from "@/entities/normalization/units";
import { mergeDrones, setFlightProfile } from "@/shared/infra/catalog-operations";

const AT = "2026-11-06T12:00:00.000Z";

const claim = (value: number, unit: string, over: Partial<SpecClaim> = {}): SpecClaim => ({
  id: `c-${value}-${unit}`,
  value,
  source: "Outlet",
  date: "2026-10-01T00:00:00.000Z",
  normalized: {
    raw: `${value} ${unit}`,
    canonicalValue: value,
    canonicalUnit: unit,
    confidence: 1,
  },
  ...over,
});

const spec = (semantic: string, unit: string, claims: SpecClaim[]): SpecAttribute => ({
  key: semantic.replace(".", "_"),
  label: semantic,
  unit,
  semantic,
  canonicalUnit: unit,
  discoveredBy: "ai",
  claims,
});

const drone = (specs: SpecAttribute[], over: Partial<Drone> = {}): Drone => ({
  id: "rm-48u",
  name: "RM-48U",
  aliases: [],
  domain: "Land",
  origin: "RU",
  operators: [],
  propulsion: "Solid fuel",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
  ...over,
});

const bounds = (d: Drone, s: SpecAttribute, c: SpecClaim) =>
  verifyClaim({ drone: d, spec: s, claim: c, at: AT })?.checks.find((k) => k.kind === "bounds");

describe("plausibleBounds", () => {
  it("keeps the general bound without a profile and swaps it for a ballistic missile", () => {
    expect(plausibleBounds("speed.max")?.max).toBe(4_000);
    expect(plausibleBounds("speed.max", "ballistic")?.max).toBe(35_000);
  });

  it("leaves a measurement the profile does not list on the general bound", () => {
    expect(plausibleBounds("endurance", "ballistic")).toBe(plausibleBounds("endurance"));
  });
});

describe("the bounds check of a ballistic missile", () => {
  // Mach 5 at sea level is 6 125 km/h: far past any aircraft or cruise missile in scope.
  const fast = claim(6_125, "km/h");
  const s = spec("speed.max", "km/h", [fast]);

  it("rejects the speed as implausible without a profile", () => {
    expect(bounds(drone([s]), s, fast)).toMatchObject({ verdict: "fail" });
  });

  it("accepts it with the profile", () => {
    expect(bounds(drone([s], { flightProfile: "ballistic" }), s, fast)).toMatchObject({
      verdict: "pass",
    });
  });

  it("reads the RM-48U's 'Mach 4-6' as in bounds for a ballistic missile, out of bounds otherwise", () => {
    const mach = claim(0, "Mach", {
      value: "4–6",
      raw: "4–6",
      normalized: normalizeQuantityLoose("4–6 Mach")!,
    });
    const m = spec("speed.stated", "Mach", [mach]);
    expect(bounds(drone([m]), m, mach)).toMatchObject({ verdict: "fail" });
    expect(bounds(drone([m], { flightProfile: "ballistic" }), m, mach)).toMatchObject({
      verdict: "pass",
    });
  });

  it("rejects a subsonic speed: a ballistic missile is not a drone", () => {
    const slow = claim(180, "km/h");
    const slowSpec = spec("speed.max", "km/h", [slow]);
    expect(bounds(drone([slowSpec]), slowSpec, slow)).toMatchObject({ verdict: "pass" });
    expect(bounds(drone([slowSpec], { flightProfile: "ballistic" }), slowSpec, slow)).toMatchObject(
      { verdict: "fail" },
    );
  });

  it("accepts an apogee in the hundreds of kilometres only with the profile", () => {
    const apogee = claim(400, "km");
    const a = spec("altitude.max", "km", [apogee]);
    expect(bounds(drone([a]), a, apogee)).toMatchObject({ verdict: "fail" });
    expect(bounds(drone([a], { flightProfile: "ballistic" }), a, apogee)).toMatchObject({
      verdict: "pass",
    });
  });

  it("accepts an ICBM's launch mass only with the profile", () => {
    const mass = claim(208_000, "kg");
    const w = spec("weight.launch", "kg", [mass]);
    expect(bounds(drone([w]), w, mass)).toMatchObject({ verdict: "fail" });
    expect(bounds(drone([w], { flightProfile: "ballistic" }), w, mass)).toMatchObject({
      verdict: "pass",
    });
  });

  it("still rejects an absurd figure for a ballistic missile", () => {
    const absurd = claim(900_000, "km/h");
    const a = spec("speed.max", "km/h", [absurd]);
    expect(bounds(drone([a], { flightProfile: "ballistic" }), a, absurd)).toMatchObject({
      verdict: "fail",
    });
  });
});

describe("auto-correction with a flight profile", () => {
  it("flags a ballistic missile's subsonic speed and leaves its Mach 5 alone", () => {
    const s = spec("speed.max", "km/h", [
      claim(6_125, "km/h", { raw: "6125 km/h" }),
      claim(180, "km/h", { raw: "180 km/h" }),
    ]);
    expect(detectCorrection(s, 0, AT)).toMatchObject({ kind: "implausible" });
    expect(detectCorrection(s, 0, AT, "ballistic")).toBeUndefined();
    expect(detectCorrection(s, 1, AT)).toBeUndefined();
    expect(detectCorrection(s, 1, AT, "ballistic")).toMatchObject({ kind: "implausible" });
  });
});

describe("recheckDroneBounds", () => {
  const fast = claim(6_125, "km/h", { evidence: "at Mach 5", sourceId: "p1" });
  const s = spec("speed.max", "km/h", [fast]);
  const verified = verifyDrone(drone([s]), () => "It flies at Mach 5.", [], AT);

  it("starts rejected, then follows the profile without losing the other checks", () => {
    const before = verified.specs[0]!.claims[0]!.verification!;
    expect(before.state).toBe("rejected");

    const after = recheckDroneBounds({ ...verified, flightProfile: "ballistic" }, AT).specs[0]!
      .claims[0]!.verification!;
    expect(after.checks.find((c) => c.kind === "bounds")?.verdict).toBe("pass");
    expect(after.state).not.toBe("rejected");
    // Every other check is exactly what it was.
    for (const c of before.checks.filter((k) => k.kind !== "bounds"))
      expect(after.checks.find((k) => k.kind === c.kind)).toBe(c);
  });

  it("returns the same entry when nothing moves", () => {
    expect(recheckDroneBounds(verified, AT)).toBe(verified);
  });

  it("never gives an analyst's claim a machine verdict", () => {
    const mine = claim(6_125, "km/h", { source: "Analyst" });
    const d = drone([spec("speed.max", "km/h", [mine])], { flightProfile: "ballistic" });
    expect(recheckDroneBounds(d, AT)).toBe(d);
  });
});

describe("setFlightProfile", () => {
  const repo = (seed: Drone[]) => {
    let items = [...seed];
    return {
      list: () => items,
      get: (id: string) => items.find((d) => d.id === id),
      upsert: (d: Drone) => {
        items = items.map((x) => (x.id === d.id ? d : x));
      },
      remove: () => {},
      search: () => items,
    };
  };
  const fast = claim(6_125, "km/h");
  const s = spec("speed.max", "km/h", [fast]);

  it("sets the profile, re-checks the bounds of its claims, and clears it again", () => {
    const stored = verifyDrone(drone([s]), () => undefined, [], AT);
    const r = repo([stored]);
    expect(stored.specs[0]!.claims[0]!.verification?.state).toBe("rejected");

    const set = setFlightProfile("rm-48u", "ballistic", { drones: r as never });
    expect(set?.flightProfile).toBe("ballistic");
    expect(r.get("rm-48u")!.specs[0]!.claims[0]!.verification?.state).not.toBe("rejected");

    const cleared = setFlightProfile("rm-48u", null, { drones: r as never });
    expect(cleared?.flightProfile).toBeUndefined();
    expect(r.get("rm-48u")!.specs[0]!.claims[0]!.verification?.state).toBe("rejected");
  });

  it("does nothing for an unknown entry", () => {
    expect(setFlightProfile("nope", "ballistic", { drones: repo([]) as never })).toBeUndefined();
  });

  it("survives a merge: the entry that remains keeps the profile either had", () => {
    const a = drone([], { id: "a", flightProfile: "ballistic" });
    const b = drone([], { id: "b" });
    const r = repo([a, b]);
    const merged = mergeDrones("b", "a", {
      drones: r as never,
      candidates: { list: () => [], upsert: () => {}, get: () => undefined } as never,
    });
    expect(merged?.flightProfile).toBe("ballistic");
  });
});
