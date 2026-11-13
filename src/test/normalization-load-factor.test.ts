import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { renormalizeClaim } from "@/entities/normalization/renormalize";
import type { Extraction } from "@/entities/drone/types";

/** One extraction holding the given specs, in the shape the normalizer reads. */
function extract(specs: Extraction["specs"]): Extraction {
  return { aliases: [], operators: [], specs, rfBands: [], rationale: "", confidence: 1 };
}

describe("load factor through normalizeExtraction", () => {
  it("reads 4g as a load factor when the attribute is one", () => {
    const { extraction } = normalizeExtraction(
      extract([{ key: "max_g", label: "Max G", value: "4g" }]),
    );
    const [spec] = extraction.specs;
    expect(spec?.semantic).toBe("maneuver.load_factor_max");
    expect(spec?.normalized).toMatchObject({
      unit: "g_load",
      canonicalUnit: "g_load",
      canonicalValue: 4,
    });
    expect(spec?.canonicalUnit).toBe("g_load");
  });

  it("reads a number with a g unit as a load factor on the same attribute", () => {
    const { extraction } = normalizeExtraction(
      extract([{ key: "g_limit", label: "G limit", value: 4, unit: "g" }]),
    );
    expect(extraction.specs[0]?.normalized).toMatchObject({
      canonicalUnit: "g_load",
      canonicalValue: 4,
    });
  });

  it("keeps 500 g as a mass on a payload, and never converts a load factor to kg or m/s2", () => {
    const { extraction } = normalizeExtraction(
      extract([
        { key: "payload_mass", label: "Payload mass", value: "500 g" },
        { key: "max_g", label: "Max load factor", value: "500 g" },
      ]),
    );
    const [payload, load] = extraction.specs;
    expect(payload?.semantic).toBe("payload.mass");
    expect(payload?.normalized).toMatchObject({ canonicalUnit: "kg", canonicalValue: 0.5 });
    expect(load?.normalized).toMatchObject({ canonicalUnit: "g_load", canonicalValue: 500 });
    expect(load?.normalized?.canonicalUnit).not.toBe("kg");
    expect(load?.normalized?.canonicalUnit).not.toBe("m/s2");
  });
});

describe("renormalizeClaim", () => {
  it("reads a stored load-factor claim with its attribute's context", () => {
    const claim = renormalizeClaim(
      { key: "max_g", label: "Max G" },
      { id: "c1", value: "4g", source: "https://example.test/report", date: "2026-01-01" },
    );
    expect(claim.normalized).toMatchObject({ unit: "g_load", canonicalValue: 4 });
  });
});
