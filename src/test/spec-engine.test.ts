import { describe, expect, it } from "vitest";
import type { Drone, ExtractedSpec } from "@/entities/drone/types";
import { mergeSpecs } from "@/entities/drone/spec-engine";

const drone = (): Drone => ({
  id: "test",
  name: "Test",
  domain: "Air",
  origin: "UA",
  propulsion: "electric",
  summary: "test",
  aliases: [],
  operators: [],
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const spec = (
  key: string,
  label: string,
  value: number | string,
  evidence?: string,
): ExtractedSpec => ({
  key,
  label,
  value,
  ...(evidence ? { evidence } : {}),
  semantic: key === "unit_cost" ? "cost.unit" : key,
});

describe("mergeSpecs", () => {
  it("does not stack exact duplicate claims (same value + same evidence)", () => {
    const d = mergeSpecs(
      drone(),
      [
        spec("speed", "Cruise speed", 800, "зі швидкістю до 800 км/год"),
        spec("speed", "Cruise speed", 800, "зі швидкістю до 800 км/год"),
      ],
      "Serhii Flash",
    );
    const speed = d.specs.find((s) => s.key === "speed")!;
    expect(speed.claims).toHaveLength(1);
    expect(speed.claims[0]!.value).toBe(800);
  });

  it("keeps distinct claims with different values under the same key", () => {
    const d = mergeSpecs(
      drone(),
      [
        spec("warhead", "Warhead mass", 50, "боевая часть – 50 или 100 кг"),
        spec("warhead", "Warhead mass", 100, "боевая часть – 50 или 100 кг"),
      ],
      "Wargonzo",
    );
    const warhead = d.specs.find((s) => s.key === "warhead")!;
    expect(warhead.claims).toHaveLength(2);
  });

  it("keeps distinct claims with different evidence under the same value", () => {
    const d = mergeSpecs(
      drone(),
      [
        spec("range", "Range", 1200, "дальность польоту сягає 1200 км"),
        spec("range", "Range", 1200, "Заявленная дальность составляет от 600 до 1200 километров"),
      ],
      "Militarnyi",
    );
    const range = d.specs.find((s) => s.key === "range")!;
    expect(range.claims).toHaveLength(2);
  });

  it("assigns canonicalUnit from normalized claim when creating a new attribute", () => {
    const d = mergeSpecs(
      drone(),
      [
        {
          key: "range",
          label: "Range",
          value: 1200,
          normalized: { raw: "1200 км", canonicalValue: 1200, canonicalUnit: "km", confidence: 1 },
        },
      ],
      "Militarnyi",
    );
    const range = d.specs.find((s) => s.key === "range")!;
    expect(range.canonicalUnit).toBe("km");
  });
});
