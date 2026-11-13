import { describe, expect, it } from "vitest";
import { normalizeQuantity } from "@/entities/normalization/units";
import { claimSourceUnit, sourceUnitFor } from "@/entities/normalization/claim-source-unit";
import { unitCheck } from "@/entities/drone/verification-measure";
import { unitStanding } from "@/entities/drone/unit-policy";
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

describe("an older claim whose normalized reading was built from a unit nobody wrote", () => {
  const spec: SpecAttribute = {
    key: "payload_mass",
    label: "Payload",
    semantic: "payload.mass",
    unit: "kg",
    discoveredBy: "ai",
    claims: [],
  };
  const built = normalizeQuantity("105 kg")!;

  it("is not kg when the quote says pounds", () => {
    const claim: SpecClaim = {
      value: 105,
      source: "s",
      date: "2026-01-01",
      evidence: "The payload weighed 105 lbs",
      normalized: built,
    };
    const r = claimSourceUnit(claim, spec);
    expect(r.unit).not.toBe("kg");
    expect(r).toMatchObject({ unit: "lb", basis: "quote" });
  });

  it("is unknown when the text names no unit, even though normalized says kg", () => {
    const claim: SpecClaim = { value: 105, source: "s", date: "2026-01-01", normalized: built };
    expect(claimSourceUnit(claim, spec)).toEqual({ basis: "unknown" });
  });

  it("is the stated unit when the source wrote one", () => {
    const claim: SpecClaim = {
      value: "105 lbs",
      raw: "105 lbs",
      source: "s",
      date: "2026-01-01",
      evidence: "The payload weighed 105 lbs",
      normalized: normalizeQuantity("105 lbs")!,
    };
    expect(claimSourceUnit(claim, spec)).toMatchObject({ unit: "lb", basis: "value_text" });
  });
});

describe("a normalized reading is never taken for the source's words", () => {
  it("leaves a multi-word unit built from the extractor unknown", () => {
    const claim: SpecClaim = {
      value: 105,
      source: "s",
      date: "2026-01-01",
      normalized: normalizeQuantity("105 nautical miles")!,
    };
    expect(claim.normalized?.raw).toBe("105 nautical miles");
    expect(claimSourceUnit(claim)).toEqual({ basis: "unknown" });
  });
});

describe("a unit that is not right after the figure", () => {
  const unit = (value: number | string, evidence: string) => sourceUnitFor({ value, evidence });
  it("is found past a plus, a range continuation and a hyphenated compound", () => {
    expect(unit(600, "Air-Launchable at 600+ km Combined Range")).toMatchObject({
      unit: "km",
      basis: "quote",
    });
    expect(unit(25, "Flight time\t25+ min")).toMatchObject({ unit: "min", basis: "quote" });
    expect(unit("150 to 200", "at ranges of 150 to 200 meters")).toMatchObject({
      unit: "m",
      basis: "quote",
    });
    expect(unit(16.3, "16.3m-long")).toMatchObject({ unit: "m", basis: "quote" });
    expect(unit(20, "Saildrone’s 20-meter-long Surveyor")).toMatchObject({
      unit: "m",
      basis: "quote",
    });
  });

  it("reads inflected Ukrainian and Russian unit words", () => {
    expect(normalizeQuantity("150 кілометрів")?.unit).toBe("km");
    expect(normalizeQuantity("550 километров")?.unit).toBe("km");
    expect(normalizeQuantity("50 кілограмів")?.unit).toBe("kg");
  });

  it("does not guess a unit that is ambiguous: 'tons' stays unread", () => {
    expect(unit(10, "a 10-Ton payload capacity").basis).toBe("unknown");
  });
});

describe("a price is not measured in kilometres", () => {
  it("has no unit to get wrong, whatever canonicalUnit the spec once stored", () => {
    const spec: SpecAttribute = {
      key: "unit_cost",
      label: "Unit cost",
      semantic: "cost.unit",
      canonicalUnit: "km",
      discoveredBy: "ai",
      claims: [],
    };
    const claim: SpecClaim = { value: 3800000, source: "s", date: "2026-01-01" };
    expect(unitStanding(spec, claim)).toBe("not_needed");
  });
});
