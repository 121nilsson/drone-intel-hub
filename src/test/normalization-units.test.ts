import { describe, expect, it } from "vitest";
import {
  canonicalUnitFor,
  convert,
  displayUnit,
  normalizeQuantity,
} from "@/entities/normalization/units";

const LOAD = { semantic: "maneuver.load_factor_max" };

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
    // Ukrainian hours ("3,5 години") read as nothing; a bare "год" stays out, as Russian for year.
    expect(normalizeQuantity("3,5 години")?.canonicalValue).toBe(210);
    expect(normalizeQuantity("2 годин")?.canonicalValue).toBe(120);
    expect(normalizeQuantity("1 год")).toBeUndefined();
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

  it("reads thrust in newtons, from kgf, кгс, kN and lbf", () => {
    expect(normalizeQuantity("8 кгс")?.canonicalValue).toBe(78.4532);
    expect(normalizeQuantity("12 kgf")?.canonicalUnit).toBe("N");
    expect(normalizeQuantity("50 kN")?.canonicalValue).toBe(50_000);
    expect(normalizeQuantity("3 кН")?.canonicalValue).toBe(3000);
    expect(normalizeQuantity("200 Newtons")?.canonicalValue).toBe(200);
    expect(normalizeQuantity("1,000 lbf")?.canonicalValue).toBeCloseTo(4448.22, 2);
    // "8 кгс" is not 8 kg, and a lowercase "kn" is still knots.
    expect(normalizeQuantity("8 кг")?.canonicalUnit).toBe("kg");
    expect(normalizeQuantity("50 kn")?.canonicalUnit).toBe("km/h");
  });

  it("reads a load factor only where the attribute is one", () => {
    // Without a context "g" is still grams: the load factor must not leak into the global list.
    expect(normalizeQuantity("4g")).toMatchObject({ unit: "g", canonicalUnit: "kg" });
    expect(normalizeQuantity("4g")?.canonicalValue).toBeCloseTo(0.004, 6);
    expect(canonicalUnitFor("g")).toBe("kg");

    const g = normalizeQuantity("4g", LOAD);
    expect(g).toMatchObject({ unit: "g_load", canonicalUnit: "g_load", canonicalValue: 4 });
    expect(normalizeQuantity("4 G", LOAD)?.canonicalValue).toBe(4);
    expect(normalizeQuantity("4 g-load", LOAD)?.unit).toBe("g_load");
    expect(normalizeQuantity("4 g's", LOAD)?.unit).toBe("g_load");
    // An unrelated attribute keeps the mass reading even when the figure is written the same way.
    expect(normalizeQuantity("4g", { semantic: "payload.mass" })?.canonicalUnit).toBe("kg");
  });

  it("does not turn a load factor into a mass, a force or an acceleration", () => {
    // 4g vs 500 g: the same letter, two different measurements.
    expect(normalizeQuantity("500 g", { semantic: "payload.mass" })).toMatchObject({
      canonicalUnit: "kg",
    });
    expect(normalizeQuantity("500 g", { semantic: "payload.mass" })?.canonicalValue).toBe(0.5);
    expect(normalizeQuantity("500 g", LOAD)?.canonicalValue).toBe(500);
    expect(normalizeQuantity("500 g", LOAD)?.canonicalUnit).toBe("g_load");

    expect(convert(4, "g_load", "g_load")).toBe(4);
    expect(convert(4, "g_load", "g")).toBeUndefined();
    expect(convert(4, "g_load", "kg")).toBeUndefined();
    expect(convert(4, "g_load", "m/s2")).toBeUndefined();
    expect(convert(4, "g", "g_load")).toBeUndefined();
    expect(canonicalUnitFor("g_load")).toBe("g_load");
  });

  it("shows the load factor as g and leaves every other unit as it is", () => {
    expect(displayUnit("g_load")).toBe("g");
    expect(displayUnit("km")).toBe("km");
    expect(displayUnit("units/month")).toBe("units/month");
  });

  it("reads count rates over every time unit", () => {
    expect(normalizeQuantity("50 units/month")).toMatchObject({
      unit: "units/month",
      canonicalUnit: "units/month",
      canonicalValue: 50,
    });
    expect(normalizeQuantity("50 systems/month")?.canonicalValue).toBe(50);
    expect(normalizeQuantity("50 per month")?.canonicalValue).toBe(50);
    expect(normalizeQuantity("50/month")?.canonicalValue).toBe(50);
    // A week is 365.25 / 12 / 7 of a month, so twelve a week is about 52 a month.
    expect(normalizeQuantity("12 per week")?.canonicalValue).toBeCloseTo(52.18, 2);
    expect(normalizeQuantity("12 units/week")?.canonicalUnit).toBe("units/month");
    expect(normalizeQuantity("30 per day")?.canonicalValue).toBeCloseTo(913.125, 3);
    expect(normalizeQuantity("2 per year")?.canonicalValue).toBeCloseTo(1 / 6, 4);
    expect(normalizeQuantity("50 шт. в месяц")?.canonicalUnit).toBe("units/month");
    expect(normalizeQuantity("50 шт. в месяц")?.canonicalValue).toBe(50);
    expect(convert(12, "units/week", "units/month")).toBeCloseTo(52.18, 2);
  });

  it("does not read a bare count or a noun-only phrase as a rate", () => {
    expect(normalizeQuantity("50 a month")).toBeUndefined();
    expect(normalizeQuantity("50 units")).toBeUndefined();
    // Hours stay out: "km/h" is a speed and a rate per hour is not a supported unit.
    expect(normalizeQuantity("50 per hour")).toBeUndefined();
  });

  it("parses the simple units exactly as before the count rates", () => {
    expect(normalizeQuantity("100 m")?.canonicalValue).toBe(0.1);
    expect(normalizeQuantity("100 m")?.canonicalUnit).toBe("km");
    expect(normalizeQuantity("5 min")).toMatchObject({ unit: "min", canonicalValue: 5 });
    expect(normalizeQuantity("120 km/h")).toMatchObject({ unit: "km/h", canonicalValue: 120 });
    expect(normalizeQuantity("30 m/s")?.canonicalValue).toBe(108);
    // A bare "d" was never a unit; the day unit is "days" or the local words for it.
    expect(normalizeQuantity("3 d")).toBeUndefined();
    expect(normalizeQuantity("3 days")?.canonicalValue).toBe(4320);
  });
});
