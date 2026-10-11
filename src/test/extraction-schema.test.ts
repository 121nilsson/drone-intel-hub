import { describe, expect, it } from "vitest";
import { AIExtractionSchema, SystemExtractionSchema } from "@/shared/contracts/extraction.schema";

describe("AI extraction schema", () => {
  it("accepts partial evidence-backed per-system output", () => {
    const result = AIExtractionSchema.safeParse({
      confidence: 0.82,
      systemExtractions: [
        {
          name: "Geran-5",
          variantOf: "geran-2",
          confidence: 0.8,
          specs: [
            { key: "weight_mtow", label: "MTOW", value: 250, unit: "kg", evidence: "MTOW 250 kg" },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the nulls the prompt asks for and the blanks models send for 'unknown'", () => {
    // The shape that failed on every provider: `matchId|null`, `unit|null`, domain "".
    const result = AIExtractionSchema.safeParse({
      name: "Geran-2",
      domain: "",
      origin: null,
      matchId: null,
      systems: [{ name: "Geran-2", matchId: null, variantOf: null }],
      systemExtractions: [
        {
          name: "Geran-2",
          matchId: null,
          variantOf: null,
          domain: "air",
          manufacturer: null,
          specs: [{ key: "range", label: "Range", value: 1000, unit: null, evidence: "" }],
          confidence: 0.7,
        },
      ],
      specs: [{ key: "speed", label: "Speed", value: 180, unit: "km/h", semantic: null }],
      confidence: 0.7,
      rationale: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.domain).toBeUndefined();
    expect(result.data.systems[0]).toEqual({ name: "Geran-2" });
    expect(result.data.systemExtractions[0]!.domain).toBe("Air");
    expect(result.data.systemExtractions[0]!.specs).toHaveLength(1);
    expect(result.data.rationale).toBe("");
  });

  it("drops a malformed item or field instead of failing the whole extraction", () => {
    const result = AIExtractionSchema.safeParse({
      name: "Lancet-3",
      origin: "Russian Federation",
      systems: ["Lancet-3", { matchId: "no-name" }],
      specs: [
        { key: "range", value: 40, unit: "km" },
        { key: "speed", label: "Speed", value: null },
        "not a spec",
      ],
      sensors: [
        { name: "EO turret", category: "Thermal" },
        { name: "Mystery", category: "sonar" },
      ],
      operators: ["RU", "Russian Armed Forces"],
      confidence: 0.6,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.origin).toBeUndefined();
    expect(result.data.systems).toEqual([{ name: "Lancet-3" }]);
    expect(result.data.specs).toEqual([{ key: "range", label: "range", value: 40, unit: "km" }]);
    expect(result.data.sensors.map((s) => s.category)).toEqual(["thermal", "other"]);
    expect(result.data.operators).toEqual(["RU"]);
  });

  it("rejects invalid confidence and non-finite numbers", () => {
    expect(
      SystemExtractionSchema.safeParse({
        name: "Test",
        confidence: 3,
        specs: [{ key: "range", label: "Range", value: Number.NaN }],
      }).success,
    ).toBe(false);
  });
});
