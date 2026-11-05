import { describe, expect, it } from "vitest";
import { claimReading, cleanReading } from "@/entities/drone/claim-reading";
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

  // The clipped phrase stays as the snapshot's value; the clean reading is a separate function.
  it("keeps claimReading's clipped wording unchanged", () => {
    const c = claim({
      value: "(approximately 100 km/h",
      raw: "(approximately 100 km/h",
      normalized: {
        raw: "(approximately 100 km/h",
        value: 100,
        unit: "km/h",
        range: { value: 100, qualifier: "approximate" },
        confidence: 1,
      },
    });
    expect(claimReading({ unit: "km/h" }, c)).toBe("(approximately 100 km/h");
  });
});

describe("a claim's clean reading", () => {
  const km = { unit: "km" };

  it("reads up to with its figure and unit", () => {
    const c = claim({
      normalized: {
        raw: "targets up to 500 km",
        unit: "km",
        range: { max: 500, qualifier: "up_to" },
        confidence: 1,
      },
    });
    expect(cleanReading(km, c)).toBe("up to 500 km");
  });

  it("reads less than with its figure and unit", () => {
    const c = claim({
      normalized: {
        raw: "less than 30 km",
        unit: "km",
        range: { max: 30, qualifier: "less_than" },
        confidence: 1,
      },
    });
    expect(cleanReading(km, c)).toBe("less than 30 km");
  });

  it("reads at least, in the unit the post used", () => {
    const c = claim({
      normalized: {
        raw: "щонайменше 3,5 години",
        unit: "h",
        canonicalUnit: "min",
        range: { min: 3.5, qualifier: "at_least" },
        confidence: 1,
      },
    });
    expect(cleanReading({ unit: "min" }, c)).toBe("at least 3.5 h");
  });

  it("reads greater than as more than", () => {
    const c = claim({
      normalized: {
        raw: "over 10 km",
        unit: "km",
        range: { min: 10, qualifier: "greater_than" },
        confidence: 1,
      },
    });
    expect(cleanReading(km, c)).toBe("more than 10 km");
  });

  it("reads approximate with approx. and drops the clipped source wording", () => {
    const c = claim({
      normalized: {
        raw: "(approximately 46 km/h",
        value: 46,
        unit: "km/h",
        range: { value: 46, qualifier: "approximate" },
        confidence: 1,
      },
    });
    expect(cleanReading({ unit: "km/h" }, c)).toBe("approx. 46 km/h");
  });

  it("reads a span as a–b with no word", () => {
    const c = claim({
      normalized: {
        raw: "170–180 km/h",
        unit: "km/h",
        range: { min: 170, max: 180, qualifier: "range" },
        confidence: 1,
      },
    });
    expect(cleanReading({ unit: "km/h" }, c)).toBe("170–180 km/h");
  });

  it("reads an exact figure as the figure and unit alone", () => {
    const c = claim({
      normalized: {
        raw: "500 km",
        value: 500,
        unit: "km",
        range: { value: 500, qualifier: "exact" },
        confidence: 1,
      },
    });
    expect(cleanReading(km, c)).toBe("500 km");
  });

  it("falls back to the unit on the attribute when the parse has none", () => {
    const c = claim({
      normalized: {
        raw: "500",
        value: 500,
        range: { value: 500, qualifier: "exact" },
        confidence: 1,
      },
    });
    expect(cleanReading(km, c)).toBe("500 km");
  });

  it("falls back to claimReading when the claim was never normalized", () => {
    expect(cleanReading(km, claim({}))).toBe(claimReading(km, claim({})));
  });
});
