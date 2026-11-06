import { describe, expect, it } from "vitest";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { renormalizeClaim, renormalizeSpec } from "@/entities/normalization/renormalize";

const claim = (over: Partial<SpecClaim>): SpecClaim => ({
  id: "c1",
  value: "up to 500 km",
  source: "Some outlet",
  date: "2026-10-01T00:00:00.000Z",
  evidence: "range of up to 500 km",
  ...over,
});

const range = { key: "range", label: "Range", unit: "km" };

describe("giving a stored claim the reading a new extraction would get", () => {
  it("parses a figure that was stored without one, qualifier included", () => {
    const next = renormalizeClaim(range, claim({}));
    expect(next.normalized?.canonicalValue ?? next.normalized?.range?.max).toBe(500);
    expect(next.normalized?.range?.qualifier).toBe("up_to");
  });

  it("uses the attribute's unit for a bare number", () => {
    const next = renormalizeClaim(range, claim({ value: 300 }));
    expect(next.normalized?.canonicalUnit).toBe("km");
    expect(next.normalized?.canonicalValue).toBe(300);
  });

  it("leaves a claim that already has a reading alone", () => {
    const has = renormalizeClaim(range, claim({ value: "400 km" }));
    expect(renormalizeClaim(range, has)).toBe(has);
  });

  it("never touches an analyst's claim", () => {
    const mine = claim({ source: "Analyst", value: "500 km" });
    expect(renormalizeClaim(range, mine)).toBe(mine);
    const typed = claim({ extractionEngine: "analyst", value: "500 km" });
    expect(renormalizeClaim(range, typed)).toBe(typed);
  });

  it("leaves a value with no figure as it is", () => {
    const text = claim({ value: "GPS" });
    expect(renormalizeClaim({ key: "guidance", label: "Guidance" }, text)).toBe(text);
  });

  it("returns the same spec when nothing changed, and is idempotent when something did", () => {
    const spec: SpecAttribute = { ...range, claims: [claim({ value: "GPS" })] } as SpecAttribute;
    expect(renormalizeSpec(spec)).toBe(spec);

    const fresh: SpecAttribute = { ...range, claims: [claim({})] } as SpecAttribute;
    const once = renormalizeSpec(fresh);
    expect(once).not.toBe(fresh);
    expect(renormalizeSpec(once)).toBe(once);
  });
});
