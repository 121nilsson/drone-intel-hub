import { describe, expect, it } from "vitest";
import {
  CORE_DIMENSIONS,
  registryEntryFor,
  toleranceFor,
} from "@/entities/normalization/core-registry";
import { CANONICAL_UNIT } from "@/entities/normalization/units";
import {
  displayUnit as displayUnitFromBarrel,
  toleranceFor as toleranceFromBarrel,
} from "@/entities/normalization";

describe("core dimensions", () => {
  it("has a row for every canonical dimension, with its physical class", () => {
    expect(CORE_DIMENSIONS.map((d) => d.dimension).sort()).toEqual(
      Object.keys(CANONICAL_UNIT).sort(),
    );
    const byDim = new Map(CORE_DIMENSIONS.map((d) => [d.dimension, d]));
    expect(byDim.get("duration")).toMatchObject({ physicalClass: "time", canonicalUnit: "min" });
    expect(byDim.get("distance")).toMatchObject({ physicalClass: "length", canonicalUnit: "km" });
    expect(byDim.get("acceleration")).toMatchObject({
      physicalClass: "acceleration",
      canonicalUnit: "m/s2",
    });
    expect(byDim.get("count_rate")).toMatchObject({
      physicalClass: "count_rate",
      canonicalUnit: "units/month",
    });
  });

  it("treats a load factor as dimensionless, stored as g_load and shown as g", () => {
    const load = CORE_DIMENSIONS.find((d) => d.dimension === "load_factor");
    expect(load).toEqual({
      dimension: "load_factor",
      physicalClass: "dimensionless",
      canonicalUnit: "g_load",
      presentationUnit: "g",
    });
  });

  it("is frozen, rows included", () => {
    expect(Object.isFrozen(CORE_DIMENSIONS)).toBe(true);
    for (const row of CORE_DIMENSIONS) expect(Object.isFrozen(row)).toBe(true);
  });
});

describe("registryEntryFor", () => {
  it("resolves an exact semantic", () => {
    expect(registryEntryFor("production.rate_monthly")).toMatchObject({
      dimension: "count_rate",
      domain: "operational",
    });
    expect(registryEntryFor("maneuver.load_factor_max")).toMatchObject({
      dimension: "load_factor",
      tolerance: { rel: 0.6, abs: 1 },
    });
    expect(registryEntryFor("cost.unit")?.dimension).toBeUndefined();
    expect(registryEntryFor("inventory.deployed_count")?.domain).toBe("programme");
  });

  it("resolves a family by prefix", () => {
    expect(registryEntryFor("speed.stated")).toMatchObject({ dimension: "speed" });
    expect(registryEntryFor("range.operational")).toMatchObject({ dimension: "distance" });
    expect(registryEntryFor("endurance.flight")).toMatchObject({
      dimension: "duration",
      domain: "operational",
    });
    expect(registryEntryFor("weight.mtow")).toMatchObject({ dimension: "mass" });
  });

  it("files every count under the count family, ahead of the payload or sensor prefix", () => {
    // "payload.missile.count" is a number of missiles, not a mass.
    const missiles = registryEntryFor("payload.missile.count");
    expect(missiles?.semantic).toBe("*.count");
    expect(missiles?.dimension).toBeUndefined();
    expect(missiles?.tolerance).toEqual({ rel: 0.6, abs: 1 });
    expect(registryEntryFor("sensor.camera.count")?.dimension).toBeUndefined();
  });

  it("returns undefined for a semantic it does not know", () => {
    expect(registryEntryFor("something.unknown")).toBeUndefined();
    expect(registryEntryFor("")).toBeUndefined();
  });

  it("is immutable", () => {
    const entry = registryEntryFor("speed.max");
    expect(entry).toBeDefined();
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry!.tolerance)).toBe(true);
    expect(() => {
      (entry as { dimension?: string }).dimension = "mass";
    }).toThrow();
    expect(() => {
      (entry!.tolerance as { abs: number }).abs = 999;
    }).toThrow();
    expect(registryEntryFor("speed.max")?.dimension).toBe("speed");
  });
});

describe("toleranceFor", () => {
  it("uses the consensus threshold of 0.6 everywhere, with a per-dimension floor", () => {
    expect(toleranceFor("speed.max")).toEqual({ rel: 0.6, abs: 0 });
    expect(toleranceFor("range.max")).toEqual({ rel: 0.6, abs: 0 });
    expect(toleranceFor("endurance.flight")).toEqual({ rel: 0.6, abs: 0 });
    expect(toleranceFor("weight.mtow")).toEqual({ rel: 0.6, abs: 0 });
    expect(toleranceFor("power.rf")).toEqual({ rel: 0.6, abs: 0 });
    expect(toleranceFor("production.rate_monthly")).toEqual({ rel: 0.6, abs: 1 });
    expect(toleranceFor("sensor.camera.count")).toEqual({ rel: 0.6, abs: 1 });
  });

  it("gives an unknown semantic a purely relative tolerance", () => {
    expect(toleranceFor("unknown.attribute")).toEqual({ rel: 0.6, abs: 0 });
    expect(Object.isFrozen(toleranceFor("unknown.attribute"))).toBe(true);
  });

  it("is exported from the normalization barrel", () => {
    expect(toleranceFromBarrel).toBe(toleranceFor);
    expect(displayUnitFromBarrel("g_load")).toBe("g");
  });
});
