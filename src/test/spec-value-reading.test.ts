import { describe, expect, it } from "vitest";
import { isFinancialSpecKey } from "@/entities/procurement/routing";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { normalizeQuantity } from "@/entities/normalization/units";
import type { Extraction } from "@/entities/drone/types";

describe("Ghost Shark report: values that read wrong", () => {
  it("routes an initial development cost out of the drone specs", () => {
    expect(isFinancialSpecKey("initial_development_cost")).toBe(true);
    expect(isFinancialSpecKey("unit_cost")).toBe(false);
    expect(isFinancialSpecKey("range")).toBe(false);
  });

  it("reads 'до 100 тонн' as an upper bound in tonnes", () => {
    const q = normalizeQuantity("до 100 тонн");
    expect(q).toMatchObject({
      unit: "t",
      canonicalUnit: "kg",
      range: { max: 100_000, qualifier: "up_to" },
    });
  });

  it("reads weeks as a duration", () => {
    expect(normalizeQuantity("3 недели")).toMatchObject({
      canonicalUnit: "min",
      canonicalValue: 30_240,
    });
  });

  it("drops a measured spec that states no figure", () => {
    const e = {
      specs: [
        { key: "endurance", label: "Endurance", value: "несколько недель" },
        { key: "range", label: "Range", value: "2000 nmi" },
      ],
      rfBands: [],
    } as unknown as Extraction;
    expect(normalizeExtraction(e).extraction.specs.map((s) => s.key)).toEqual(["range"]);
  });
});
