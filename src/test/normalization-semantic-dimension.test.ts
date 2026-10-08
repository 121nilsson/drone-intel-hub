import { describe, expect, it } from "vitest";
import { consensus } from "@/entities/drone/consensus";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import type { Extraction, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { normalizeQuantity } from "@/entities/normalization/units";

describe("dimension semantics", () => {
  it("maps hull dimensions to metres, not kilometres", () => {
    expect(semanticKeyFor("length", "Length")).toBe("dimension.length");
    expect(semanticKeyFor("diameter", "Diameter")).toBe("dimension.diameter");
    expect(canonicalUnitForSemantic("dimension.length")).toBe("m");
  });

  it("normalizes intake specs in metres", () => {
    const { extraction } = normalizeExtraction({
      aliases: [],
      operators: [],
      specs: [
        { key: "length", label: "Length", value: "7 m" },
        { key: "diameter", label: "Diameter", value: "0.45 m" },
      ],
      rfBands: [],
      confidence: 1,
      rationale: "",
    });
    expect(extraction.specs[0]?.normalized?.canonicalValue).toBe(7);
    expect(extraction.specs[0]?.normalized?.canonicalUnit).toBe("m");
    expect(extraction.specs[1]?.normalized?.canonicalValue).toBeCloseTo(0.45, 4);
  });

  it("shows consensus for length in metres even when stored claims used km canonical", () => {
    const normalized = normalizeQuantity("7 m");
    if (!normalized) throw new Error("expected 7 m to parse");
    const claim: SpecClaim = {
      value: "7 m",
      raw: "7 m",
      source: "Covert Shores",
      date: "2026-01-01T00:00:00.000Z",
      normalized,
      normalizationConfidence: 1,
    };
    const spec: SpecAttribute = {
      key: "length",
      label: "Length",
      semantic: "dimension.length",
      canonicalUnit: "m",
      discoveredBy: "ai",
      claims: [claim],
    };
    expect(consensus(spec).display).toBe("7 m");
  });
});
