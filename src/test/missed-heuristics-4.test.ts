import { describe, expect, it } from "vitest";
import { extractClassSpecs } from "@/shared/infra/heuristics";

function specs(raw: string) {
  const out: Array<{ key: string; value: number | string; unit: string | undefined }> = [];
  extractClassSpecs(raw, (key, _l, value, unit) => out.push({ key, value, unit }));
  return out;
}

describe("missed heuristics from live DB (4)", () => {
  it("captures Ukrainian endurance in minutes (Миротворець)", () => {
    const s = specs("тривалість польоту — до 45 хвилин");
    expect(s).toContainEqual({ key: "endurance", value: 45, unit: "min" });
  });

  it("captures fuel capacity in liters (Миротворець)", () => {
    const s = specs("має запас пального 15 л");
    expect(s).toContainEqual({ key: "fuel_capacity", value: 15, unit: "l" });
  });

  it("captures an English fuel capacity", () => {
    const s = specs("The UAV has a fuel capacity of 120 liters.");
    expect(s).toContainEqual({ key: "fuel_capacity", value: 120, unit: "l" });
  });
});
