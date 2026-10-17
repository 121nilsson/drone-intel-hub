import { describe, expect, it } from "vitest";
import { normalizeQuantity } from "@/entities/normalization/units";

describe("normalizeQuantity", () => {
  it("converts distance, speed, mass, and duration into canonical units", () => {
    const miles = normalizeQuantity("80 miles");
    expect(miles?.value).toBe(80);
    expect(miles?.unit).toBe("mi");
    expect(miles?.canonicalUnit).toBe("km");
    expect(miles?.canonicalValue).toBeCloseTo(128.74752, 4);
    expect(miles?.raw).toBe("80 miles");

    expect(normalizeQuantity("70 nm")?.canonicalValue).toBeCloseTo(129.64, 4);
    expect(normalizeQuantity("70 nautical miles")?.canonicalValue).toBeCloseTo(129.64, 4);
    expect(normalizeQuantity("1000 m")?.canonicalValue).toBe(1);
    expect(normalizeQuantity("130 км")?.canonicalValue).toBe(130);

    expect(normalizeQuantity("100 mph")?.canonicalValue).toBeCloseTo(160.9344, 3);
    expect(normalizeQuantity("90 knots")?.canonicalValue).toBeCloseTo(166.68, 2);
    expect(normalizeQuantity("30 m/s")?.canonicalValue).toBe(108);
    expect(normalizeQuantity("185 км/ч")?.canonicalUnit).toBe("km/h");
    // Sea units: "45 вузлів" normalized to nothing before the Ukrainian fragment existed.
    expect(normalizeQuantity("45 вузлів")?.canonicalUnit).toBe("km/h");
    expect(normalizeQuantity("45 вузлів")?.canonicalValue).toBe(83.34);
    expect(normalizeQuantity("700 nautical miles")?.canonicalValue).toBe(1296.4);

    expect(normalizeQuantity("2 hours")?.canonicalValue).toBe(120);
    expect(normalizeQuantity("5400 seconds")?.canonicalValue).toBe(90);
    // Days endurance: USV sources state autonomy in діб/суток, which had no unit at all.
    expect(normalizeQuantity("3 days")?.canonicalValue).toBe(4320);
    expect(normalizeQuantity("3 діб")?.canonicalValue).toBe(4320);
    // Ukrainian minutes / liters - live claims that normalized to nothing before.
    expect(normalizeQuantity("45 хвилин")?.canonicalValue).toBe(45);
    expect(normalizeQuantity("45 хвилин")?.canonicalUnit).toBe("min");
    expect(normalizeQuantity("15 л")?.canonicalValue).toBe(15);
    expect(normalizeQuantity("15 л")?.canonicalUnit).toBe("l");
    expect(normalizeQuantity("150 gallons")?.canonicalValue).toBeCloseTo(567.81, 2);
    expect(normalizeQuantity("2.5 kg")?.canonicalUnit).toBe("kg");
    expect(normalizeQuantity("500 г")?.canonicalValue).toBeCloseTo(0.5, 4);
  });

  it("does not turn a bound or a span into an exact point", () => {
    const upTo = normalizeQuantity("up to 120 km");
    expect(upTo?.canonicalValue).toBeUndefined();
    expect(upTo?.range).toEqual({ max: 120, qualifier: "up_to" });

    const span = normalizeQuantity("80–120 km");
    expect(span?.canonicalValue).toBeUndefined();
    expect(span?.range?.qualifier).toBe("range");
    expect(span?.range?.min).toBe(80);
    expect(span?.range?.max).toBe(120);

    const miles = normalizeQuantity("80 miles");
    expect(miles?.confidence).toBe(1);
    expect(normalizeQuantity("~80 km")?.confidence).toBe(0.9);
  });

  it("returns undefined when no unit is present", () => {
    expect(normalizeQuantity("")).toBeUndefined();
    expect(normalizeQuantity("80")).toBeUndefined();
    expect(normalizeQuantity("—")).toBeUndefined();
  });

  it("keeps converted ranges free of float noise", () => {
    // Live Red Wolf claim: 200 × 1.852 must not carry IEEE754 noise into the dossier.
    expect(normalizeQuantity("exceeding 200 nautical miles")?.range?.min).toBe(370.4);
  });
});
