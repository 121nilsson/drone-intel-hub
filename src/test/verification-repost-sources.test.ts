import { describe, expect, it } from "vitest";
import { independentSourceCount } from "@/entities/drone/verification";
import type { SpecAttribute, SpecClaim } from "@/entities/drone/types";

/** Two hashes that differ in exactly 3 bits, and two that differ in all 64. */
const HASH = "0000000000000000";
const NEAR = "0000000000000007";
const FAR = "ffffffffffffffff";

const claim = (source: string, contentHash?: string): SpecClaim => ({
  id: crypto.randomUUID(),
  value: 2_000,
  source,
  date: "2026-10-01T00:00:00.000Z",
  normalized: { raw: "2000 km", canonicalValue: 2_000, canonicalUnit: "km", confidence: 1 },
  ...(contentHash ? { lineage: { contentHash } } : {}),
});

const spec = (claims: SpecClaim[]): SpecAttribute => ({
  key: "range_max",
  label: "range_max",
  unit: "km",
  semantic: "range.max",
  canonicalUnit: "km",
  discoveredBy: "ai",
  claims,
});

describe("independent sources of a repost", () => {
  it("counts two outlets carrying near-identical text as one source", () => {
    const s = spec([
      claim("Outlet A · https://a.example/1", HASH),
      claim("Outlet B · https://b.example/1", NEAR),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(1);
  });

  it("counts two outlets with far-apart text as two sources", () => {
    const s = spec([
      claim("Outlet A · https://a.example/1", HASH),
      claim("Outlet B · https://b.example/1", FAR),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(2);
  });

  it("counts two outlets as two sources when one claim has no hash", () => {
    const s = spec([
      claim("Outlet A · https://a.example/1", HASH),
      claim("Outlet B · https://b.example/1"),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(2);
    expect(independentSourceCount(s, s.claims[1]!)).toBe(2);
  });

  it("chains a repost through a shared outlet: A reposts B's text, and C is B's outlet", () => {
    const s = spec([
      claim("Outlet A · https://a.example/1", HASH),
      claim("Outlet B · https://b.example/1", NEAR),
      claim("Outlet B · https://b.example/2", FAR),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(1);
  });

  it("still counts by outlet alone when no claim carries a hash", () => {
    const s = spec([
      claim("Outlet A · https://a.example/1"),
      claim("Outlet B · https://b.example/1"),
      claim("Outlet C · https://c.example/1"),
    ]);
    expect(independentSourceCount(s, s.claims[0]!)).toBe(3);
  });
});
