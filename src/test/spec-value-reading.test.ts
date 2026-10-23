import { describe, expect, it } from "vitest";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import type { Drone } from "@/entities/drone/types";
import { isFinancialSpecKey } from "@/entities/procurement/routing";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { normalizeQuantity } from "@/entities/normalization/units";
import type { Extraction } from "@/entities/drone/types";

describe("Ghost Shark report: values that read wrong", () => {
  it("routes an initial development cost out of the drone specs", () => {
    expect(isFinancialSpecKey("initial_development_cost")).toBe(true);
    expect(isFinancialSpecKey("unit_cost")).toBe(false);
    expect(isFinancialSpecKey("range")).toBe(false);
  });

  it("reads 'до 100 тонн' as an upper bound in tonnes", () => {
    const q = normalizeQuantity("до 100 тонн");
    expect(q).toMatchObject({
      unit: "t",
      canonicalUnit: "kg",
      range: { max: 100_000, qualifier: "up_to" },
    });
  });

  it("reads weeks as a duration", () => {
    expect(normalizeQuantity("3 недели")).toMatchObject({
      canonicalUnit: "min",
      canonicalValue: 30_240,
    });
  });

  it("drops a measured spec that states no figure", () => {
    const e = {
      specs: [
        { key: "endurance", label: "Endurance", value: "несколько недель" },
        { key: "range", label: "Range", value: "2000 nmi" },
      ],
      rfBands: [],
    } as unknown as Extraction;
    expect(normalizeExtraction(e).extraction.specs.map((s) => s.key)).toEqual(["range"]);
  });
});

describe("K3 Scout: one top speed, not three", () => {
  const claim = (value: number) => ({ id: `c${value}`, value, source: "t", date: "d" });
  const attr = (key: string, label: string, semantic: string, unit: string, value: number) => ({
    key,
    label,
    semantic,
    unit,
    claims: [claim(value)],
    discoveredBy: "ai" as const,
  });

  it("reads kt and kn as knots", () => {
    expect(normalizeQuantity("55 kt")).toMatchObject({ unit: "kn", canonicalUnit: "km/h" });
    expect(normalizeQuantity("55 kn")).toMatchObject({ unit: "kn" });
  });

  it("reads a camelCase key as the same attribute", () => {
    expect(semanticKeyFor("maxSpeed", "Max Speed")).toBe("speed.max");
    expect(semanticKeyFor("speed", "Cruise speed")).toBe("speed.cruise");
  });

  it("folds rows that already measure the same thing into one", () => {
    const drone = {
      specs: [
        attr("maxSpeed", "Max Speed", "maxSpeed", "kt", 55),
        attr("speed", "Maximum speed", "speed.max", "km/h", 102),
        attr("speed", "Cruise speed", "speed.cruise", "km/h", 46),
      ],
    } as unknown as Drone;
    const out = mergeSpecs(drone, [], "t");
    expect(out.specs.map((s) => s.semantic)).toEqual(["speed.max", "speed.cruise"]);
    expect(out.specs[0]!.claims.map((c) => c.value)).toEqual([55, 102]);
  });
});
