import { describe, expect, it } from "vitest";
import { ExtractedSpecSchema } from "@/shared/contracts/extraction.schema";
import { semanticKeyFor } from "@/entities/normalization/semantic";

describe("spec key normalization at the extraction boundary", () => {
  it("cleans punctuation noise out of a model key", () => {
    // Live data held a spec keyed "target_capability'," — quote and comma included — alongside a
    // clean twin, splitting one concept across two keys.
    const spec = ExtractedSpecSchema.parse({ key: "target_capability',", value: 1 });
    expect(spec.key).toBe("target_capability");
    expect(spec.label).toBe("target_capability',");
  });

  it("folds camelCase and display-case variants into snake_case", () => {
    for (const key of ["speedMax", "Speed Max", "SPEED-MAX"])
      expect(ExtractedSpecSchema.parse({ key, value: 1 }).key).toBe("speed_max");
  });

  it("maps the folded variants onto canonical semantics", () => {
    expect(semanticKeyFor("speed_max")).toBe("speed.max");
    expect(semanticKeyFor("top_speed")).toBe("speed.max");
    expect(semanticKeyFor("speed_cruise")).toBe("speed.cruise");
    expect(semanticKeyFor("altitude", "Altitude")).toBe("altitude.max");
    expect(semanticKeyFor("fuel_capacity")).toBe("capacity.fuel");
    // A stated minimum is a different reading and keeps its own key.
    expect(semanticKeyFor("altitude", "Minimum altitude")).toBe("altitude");
  });
});
