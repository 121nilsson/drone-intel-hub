import { describe, expect, it } from "vitest";
import { parseMagnitude, parseNumber, parseRange } from "@/entities/normalization/numeric";

describe("parseNumber", () => {
  it("treats a grouped comma as thousands and a short comma as a decimal", () => {
    expect(parseNumber("1,500")).toBe(1500);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("0,500")).toBe(0.5);
    expect(parseNumber("2.5")).toBe(2.5);
    expect(parseNumber("1 500")).toBe(1500);
    expect(parseNumber("1\u00a0500")).toBe(1500);
  });

  it("returns undefined for empty or non-numeric text and does not throw", () => {
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("km")).toBeUndefined();
    expect(parseNumber("—")).toBeUndefined();
  });
});

describe("parseMagnitude", () => {
  it("expands magnitude suffixes", () => {
    expect(parseMagnitude("25k")).toBe(25_000);
    expect(parseMagnitude("2.5M")).toBe(2_500_000);
    expect(parseMagnitude("500 млн")).toBe(500_000_000);
  });

  it("does not treat a bare m as million", () => {
    expect(parseMagnitude("2.5m")).toBeUndefined();
  });
});

describe("parseRange", () => {
  it("keeps an upper bound from becoming an exact point", () => {
    expect(parseRange("up to 120")).toEqual({ max: 120, qualifier: "up_to" });
    expect(parseRange("80–120")).toEqual({ min: 80, max: 120, qualifier: "range" });
    expect(parseRange("80 to 120")).toEqual({ min: 80, max: 120, qualifier: "range" });
    expect(parseRange("~80")).toEqual({ value: 80, qualifier: "approximate" });
    expect(parseRange("more than 100")).toEqual({ min: 100, qualifier: "greater_than" });
    expect(parseRange("at least 50")).toEqual({ min: 50, qualifier: "at_least" });
    expect(parseRange("less than 50")).toEqual({ max: 50, qualifier: "less_than" });
  });
});
