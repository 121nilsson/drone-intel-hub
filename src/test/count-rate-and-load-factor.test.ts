import { describe, expect, it } from "vitest";
import { normalizeQuantity } from "@/entities/normalization/units";
import { sourceUnitFor } from "@/entities/normalization/claim-source-unit";
import { unitCheck } from "@/entities/drone/verification-measure";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";

describe("count rates", () => {
  it("do not read ordinary Cyrillic phrases as a rate", () => {
    expect(normalizeQuantity("40 на дальности")).toBeUndefined();
    expect(normalizeQuantity("5 в диапазоне")).toBeUndefined();
  });

  it("read the Russian words for a day, and a bare 'monthly'", () => {
    expect(normalizeQuantity("12 в день")?.unit).toBe("units/day");
    expect(normalizeQuantity("12 в сутки")?.unit).toBe("units/day");
    expect(normalizeQuantity("50 monthly")).toMatchObject({
      unit: "units/month",
      canonicalValue: 50,
    });
  });
});

describe("load factor spellings", () => {
  const ctx = { semantic: "maneuver.load_factor_max" };
  it("reads 4 Gs, 4 g-force and 4 g load as a load factor, only in that context", () => {
    for (const text of ["4 Gs", "4 g-force", "4 g load", "4g"])
      expect(normalizeQuantity(text, ctx)).toMatchObject({ unit: "g_load", canonicalValue: 4 });
    expect(normalizeQuantity("4g")?.canonicalUnit).toBe("kg");
  });
});

describe("the unit check under a load factor attribute", () => {
  const spec: SpecAttribute = {
    key: "max_g",
    label: "Max G",
    semantic: "maneuver.load_factor_max",
    discoveredBy: "ai",
    claims: [],
  };
  it("passes '4g' and does not read it as 0.004 kg", () => {
    const claim: SpecClaim = { value: "4g", raw: "4g", source: "s", date: "2026-01-01" };
    expect(unitCheck(spec, claim, "t").verdict).toBe("pass");
  });

  it("reads again a stored reading made before the attribute was a load factor", () => {
    const claim: SpecClaim = {
      value: "4g",
      raw: "4g",
      source: "s",
      date: "2026-01-01",
      normalized: normalizeQuantity("4g")!,
    };
    expect(claim.normalized?.canonicalUnit).toBe("kg");
    expect(unitCheck(spec, claim, "t").verdict).toBe("pass");
  });
});

describe("a figure stated twice in a quote with different units", () => {
  it("takes the occurrence whose unit the extractor named, instead of calling it a conflict", () => {
    const r = sourceUnitFor({
      value: 150,
      unit: "km/h",
      evidence: "a range of 150 km and flies at 150 km/h",
    });
    expect(r).toMatchObject({ unit: "km/h", basis: "quote" });
  });

  it("still calls it a conflict when no occurrence carries the extractor's unit", () => {
    const r = sourceUnitFor({ value: 150, unit: "kg", evidence: "a range of 150 km" });
    expect(r.basis).toBe("conflict");
  });
});
