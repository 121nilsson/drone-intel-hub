import { describe, expect, it } from "vitest";
import { claimReading } from "@/entities/drone/claim-reading";
import type { SpecClaim } from "@/entities/drone/types";

const claim = (over: Partial<SpecClaim>): SpecClaim => ({
  value: 40,
  source: "s",
  date: "2026-11-01",
  ...over,
});

describe("a claim's value as a judge sees it", () => {
  // Live audit claim: "Capable of speeds around 40 knots" was shown as "Speed = 40".
  it("gives a bare figure its unit and the catalogue's conversion", () => {
    const c = claim({
      normalized: {
        raw: "40 kn",
        value: 40,
        unit: "kn",
        canonicalValue: 74.08,
        canonicalUnit: "km/h",
        confidence: 1,
      },
    });
    expect(claimReading({ unit: "kn" }, c)).toBe("40 kn (≈ 74.08 km/h)");
  });

  it("uses the attribute's unit when the claim was never normalized", () => {
    expect(claimReading({ unit: "km" }, claim({}))).toBe("40 km");
  });

  it("keeps the source's own wording when it carries its unit", () => {
    expect(
      claimReading({ unit: "km" }, claim({ value: "up to 300 km", raw: "up to 300 km" })),
    ).toBe("up to 300 km");
  });

  it("shows a bound in the catalogue's unit", () => {
    const c = claim({
      value: "щонайменше 3,5 години",
      raw: "щонайменше 3,5 години",
      normalized: {
        raw: "щонайменше 3,5 години",
        unit: "h",
        canonicalUnit: "min",
        range: { min: 210, qualifier: "at_least" },
        confidence: 1,
      },
    });
    expect(claimReading({ unit: "min" }, c)).toBe("щонайменше 3,5 години (≈ ≥ 3.5 h)");
  });

  it("leaves a count without a unit alone", () => {
    expect(claimReading({}, claim({ value: 12 }))).toBe("12");
  });
});
