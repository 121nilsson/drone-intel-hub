import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import { normalizeQuantity } from "@/entities/normalization/units";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";

function claim(raw: string, source: string): SpecClaim {
  const normalized = normalizeQuantity(raw);
  return {
    value: raw,
    raw,
    source,
    date: "2026-01-01T00:00:00.000Z",
    ...(normalized ? { normalized, normalizationConfidence: normalized.confidence } : {}),
  };
}

describe("consensus on normalized quantities", () => {
  it("aggregates miles and kilometres as kilometres", () => {
    const spec: SpecAttribute = {
      key: "range",
      label: "Range",
      unit: "km",
      semantic: "range.max",
      canonicalUnit: "km",
      discoveredBy: "ai",
      claims: [claim("80 miles", "a"), claim("130 km", "b"), claim("125 km", "c")],
    };
    const c = consensus(spec);
    expect(c.sources).toBe(3);
    expect(c.min).toBeCloseTo(125, 2);
    expect(c.max).toBeCloseTo(130, 2);
    expect(c.median).toBeCloseTo(128.75, 1);
    expect(c.display).toBe("128.75 km");
    expect(c.disputed).toBe(false);
  });

  it("does not treat an upper bound as an exact point in the median", () => {
    const spec: SpecAttribute = {
      key: "range",
      label: "Range",
      semantic: "range.max",
      canonicalUnit: "km",
      discoveredBy: "ai",
      claims: [claim("100 km", "a"), claim("up to 120 km", "b")],
    };
    const c = consensus(spec);
    expect(c.median).toBe(100);
    expect(c.display).toBe("100 km");
    expect(c.max).toBe(120);
  });

  it("converts a numeric claim from its attribute unit at read time", () => {
    const spec: SpecAttribute = {
      key: "range",
      label: "Range",
      unit: "mi",
      discoveredBy: "seed",
      claims: [{ value: 80, source: "a", date: "2026-01-01T00:00:00.000Z" }],
    };
    expect(consensus(spec).display).toBe("128.75 km");
  });

  it("does not merge a different semantic just because the unit matches", () => {
    const max: SpecAttribute = {
      key: "range",
      label: "Range",
      semantic: "range.max",
      unit: "km",
      discoveredBy: "ai",
      claims: [{ value: 1000, source: "a", date: "2026-01-01T00:00:00.000Z" }],
    };
    const operational: SpecAttribute = {
      key: "operational_range",
      label: "Operational range",
      semantic: "range.operational",
      unit: "km",
      discoveredBy: "ai",
      claims: [{ value: 400, source: "a", date: "2026-01-01T00:00:00.000Z" }],
    };
    expect(consensus(max).display).toBe("1000 km");
    expect(consensus(operational).display).toBe("400 km");
    expect(max.semantic).not.toBe(operational.semantic);
  });
});
