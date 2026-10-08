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

    expect(normalizeQuantity("2 hours")?.canonicalValue).toBe(120);
    expect(normalizeQuantity("5400 seconds")?.canonicalValue).toBe(90);
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
});
