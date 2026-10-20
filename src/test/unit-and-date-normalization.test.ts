import { describe, expect, it } from "vitest";
import { normalizeQuantity } from "@/entities/normalization/units";
import { normalizeDate } from "@/entities/normalization/dates";
import { consensus } from "@/entities/drone/consensus";
import type { Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";

const claim = (value: string | number, source = "s"): SpecClaim => ({
  value,
  source,
  date: "2026-10-20T00:00:00.000Z",
});

const spec = (over: Partial<SpecAttribute> = {}): SpecAttribute => ({
  key: "altitude",
  label: "Service Ceiling",
  semantic: "altitude.service_ceiling",
  unit: "km",
  canonicalUnit: "km",
  discoveredBy: "ai",
  claims: [],
  ...over,
});

describe("units the normalizer did not know", () => {
  it("reads a figure stated in feet", () => {
    const q = normalizeQuantity("45,000 feet");
    expect(q?.canonicalValue).toBeCloseTo(13.716, 3);
    expect(q?.canonicalUnit).toBe("km");
  });

  it("reads a unit written before its number", () => {
    expect(normalizeQuantity("Mach 0.8")?.canonicalValue).toBe(980);
    expect(normalizeQuantity("Mach 0.86")?.canonicalValue).toBeCloseTo(1053.5, 1);
  });

  it("reads a figure stated in metric tons", () => {
    expect(normalizeQuantity("3 metric tons")?.canonicalValue).toBe(3000);
  });
});

describe("consensus", () => {
  it("shows an altitude in the catalogue's unit, not in the source's", () => {
    const s = spec({ claims: [claim("45,000 feet", "The War Zone")] });
    expect(consensus(s).display).toBe("13.72 km");
  });

  it("counts a claim written in another language", () => {
    const s: SpecAttribute = {
      key: "speed",
      label: "Speed",
      semantic: "speed",
      discoveredBy: "ai",
      claims: [claim("0.8 Маха", "Militarnyi"), claim("0.8 Mach", "Militarnyi")],
    };
    expect(consensus(s).display).toBe("980 km/h");
    expect(consensus(s).disputed).toBe(false);
  });

  it("counts the same figure written two ways", () => {
    const s = spec({
      key: "max_speed",
      label: "Maximum speed",
      semantic: "speed.max",
      unit: "Mach",
      canonicalUnit: "km/h",
      claims: [claim("Mach 0.8", "EDR"), claim("0.8 Mach", "TWZ")],
    });
    expect(consensus(s).display).toBe("980 km/h");
  });
});

describe("dates", () => {
  it("reads a Ukrainian date", () => {
    expect(normalizeDate("12 жовтня 2025 року")).toBe("2025-10-12");
  });

  it("reads the other spellings a source uses", () => {
    expect(normalizeDate("2025-10-12")).toBe("2025-10-12");
    expect(normalizeDate("12.10.2025")).toBe("2025-10-12");
    expect(normalizeDate("12 October 2025")).toBe("2025-10-12");
    expect(normalizeDate("October 12, 2025")).toBe("2025-10-12");
    expect(normalizeDate("12 октября 2025")).toBe("2025-10-12");
  });

  it("does not read a quantity as a date", () => {
    expect(normalizeDate("45,000 feet")).toBeUndefined();
    expect(normalizeDate("3 metric tons")).toBeUndefined();
    expect(normalizeDate("Rocket assisted takeoff")).toBeUndefined();
    expect(normalizeDate("500 kg warhead")).toBeUndefined();
  });
});

describe("the drone type still compiles", () => {
  it("keeps the shape", () => {
    const d: Pick<Drone, "id" | "name"> = { id: "x", name: "y" };
    expect(d.id).toBe("x");
  });
});
