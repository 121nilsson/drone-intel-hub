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
