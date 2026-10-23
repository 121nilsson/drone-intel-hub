import { describe, expect, it } from "vitest";
import { semanticKeyFor, canonicalUnitForSemantic } from "@/entities/normalization/semantic";

describe("semanticKeyFor", () => {
  it("maps range_min to range.min", () => {
    expect(semanticKeyFor("range_min", "Минимальная дальность")).toBe("range.min");
  });

  it("maps range_max to range.max", () => {
    expect(semanticKeyFor("range_max", "Максимальная дальность")).toBe("range.max");
  });

  it("maps warhead_max to payload.warhead", () => {
    expect(semanticKeyFor("warhead_max", "Масса боевой части (максимум)")).toBe("payload.warhead");
  });

  it("maps warhead to payload.warhead", () => {
    expect(semanticKeyFor("warhead", "Warhead mass")).toBe("payload.warhead");
  });

  it("keeps cost.unit semantic for unit_cost", () => {
    expect(semanticKeyFor("unit_cost", "Unit Cost / Price")).toBe("cost.unit");
  });
});

describe("canonicalUnitForSemantic", () => {
  it("returns km for range.min", () => {
    expect(canonicalUnitForSemantic("range.min")).toBe("km");
  });

  it("returns kg for payload.warhead", () => {
    expect(canonicalUnitForSemantic("payload.warhead")).toBe("kg");
  });

  it("returns undefined for cost.unit", () => {
    expect(canonicalUnitForSemantic("cost.unit")).toBeUndefined();
  });
});
