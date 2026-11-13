import { describe, expect, it } from "vitest";
import type {
  Drone,
  ExtractedSpec,
  Extraction,
  SpecAttribute,
  SpecClaim,
} from "@/entities/drone/types";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import { unitCheck } from "@/entities/drone/verification-measure";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { claimSourceUnit, sourceUnitFor } from "@/entities/normalization/claim-source-unit";

const claim = (over: Partial<SpecClaim> = {}): SpecClaim => ({
  id: "c1",
  value: 105,
  source: "Outlet · https://example.test/post",
  date: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("claimSourceUnit", () => {
  it("reads a unit the value text states", () => {
    expect(claimSourceUnit(claim({ value: "105 lbs", raw: "105 lbs" }))).toEqual({
      unit: "lb",
      basis: "value_text",
    });
  });

  it("reads a unit beside the figure in the quote", () => {
    expect(claimSourceUnit(claim({ evidence: "payload of 105 kg" }))).toEqual({
      unit: "kg",
      basis: "quote",
    });
  });

  it("does not take a unit further along the quote for the figure's", () => {
    expect(claimSourceUnit(claim({ evidence: "105 people flew 40 kg" }))).toEqual({
      basis: "unknown",
    });
  });

  it("keeps an extractor unit the text neither confirms nor contradicts as unverified", () => {
    expect(sourceUnitFor({ value: 105, unit: "kg" })).toEqual({
      unit: "kg",
      basis: "extractor_unverified",
    });
  });

  it("is unknown for a bare figure, even when the attribute has a unit", () => {
    const spec = { unit: "kg" };
    expect(claimSourceUnit(claim(), spec)).toEqual({ basis: "unknown" });
    expect(claimSourceUnit(claim(), spec, { extractorUnitIsClaimLevel: false })).toEqual({
      basis: "unknown",
    });
  });

  it("reads the spec unit as the claim's extractor unit only when told it is claim-level", () => {
    expect(claimSourceUnit(claim(), { unit: "kg" }, { extractorUnitIsClaimLevel: true })).toEqual({
      unit: "kg",
      basis: "extractor_unverified",
    });
  });

  it("chooses no unit when the quote and the extractor disagree", () => {
    const written = sourceUnitFor({ value: 105, unit: "kg", evidence: "weighs 105 lbs" });
    expect(written.basis).toBe("conflict");
    expect(written.unit).toBeUndefined();
  });

  it("reports both units when a live check finds the disagreement", () => {
    const live = claimSourceUnit(claim({ evidence: "weighs 105 lbs", sourceUnit: "kg" }));
    expect(live.basis).toBe("conflict");
    expect(live.unit).toBeUndefined();
    expect(live.disagreement).toEqual({ extractor: "kg", evidenced: "lb", basis: "quote" });
  });

  it("uses the quote's unit when the extractor agrees with it", () => {
    expect(sourceUnitFor({ value: 105, unit: "kg", evidence: "payload of 105 kg" })).toEqual({
      unit: "kg",
      basis: "quote",
    });
  });

  it("treats kilograms and kg as the same unit", () => {
    expect(sourceUnitFor({ value: 105, unit: "kilograms", evidence: "payload of 105 kg" })).toEqual(
      { unit: "kg", basis: "quote" },
    );
    expect(sourceUnitFor({ value: 105, unit: "kg", evidence: "weighs 105 kilograms" })).toEqual({
      unit: "kg",
      basis: "quote",
    });
  });

  it("does not treat pounds and kilograms as the same unit", () => {
    expect(sourceUnitFor({ value: 105, unit: "kg", evidence: "weighs 105 lbs" }).basis).toBe(
      "conflict",
    );
  });

  it("respects a basis already on the claim", () => {
    expect(
      claimSourceUnit(
        claim({ evidence: "weighs 105 lbs", sourceUnit: "lb", sourceUnitBasis: "quote" }),
      ),
    ).toEqual({ unit: "lb", basis: "quote" });
    expect(
      claimSourceUnit(claim({ evidence: "weighs 105 lbs", sourceUnitBasis: "unknown" })),
    ).toEqual({ basis: "unknown" });
  });

  it("does not take a normalized reading built from the value as source text", () => {
    const built = claim({
      normalized: {
        raw: "105 kg",
        value: 105,
        unit: "kg",
        canonicalUnit: "kg",
        canonicalValue: 105,
        range: { qualifier: "exact", value: 105 },
        confidence: 1,
      },
    });
    expect(claimSourceUnit(built)).toEqual({ basis: "unknown" });
  });
});

describe("extraction to claim", () => {
  const extraction = (specs: ExtractedSpec[]): Extraction => ({
    aliases: [],
    operators: [],
    specs,
    rfBands: [],
    confidence: 0.8,
    rationale: "",
  });

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

  it("writes the source unit on the spec and copies it onto the claim", () => {
    const { extraction: normalized } = normalizeExtraction(
      extraction([
        {
          key: "max_payload",
          label: "Max payload",
          value: 105,
          unit: "kg",
          evidence: "payload of 105 kg",
        },
      ]),
    );
    const spec = normalized.specs[0]!;
    expect(spec).toMatchObject({ sourceUnit: "kg", sourceUnitBasis: "quote" });
    const merged = mergeSpecs(drone(), normalized.specs, "Outlet");
    expect(merged.specs[0]!.claims[0]).toMatchObject({
      sourceUnit: "kg",
      sourceUnitBasis: "quote",
    });
  });

  it("records a conflict and no unit for a figure whose quote names another unit", () => {
    const { extraction: normalized } = normalizeExtraction(
      extraction([
        {
          key: "max_payload",
          label: "Max payload",
          value: 105,
          unit: "kg",
          evidence: "weighs 105 lbs",
        },
      ]),
    );
    const merged = mergeSpecs(drone(), normalized.specs, "Outlet");
    const stored = merged.specs[0]!.claims[0]!;
    expect(stored.sourceUnitBasis).toBe("conflict");
    expect(stored.sourceUnit).toBeUndefined();
  });

  it("omits the source unit fields when the extraction has none", () => {
    const merged = mergeSpecs(
      drone(),
      [{ key: "max_payload", label: "Max payload", value: 105 }],
      "Outlet",
    );
    const stored = merged.specs[0]!.claims[0]!;
    expect(stored).not.toHaveProperty("sourceUnit");
    expect(stored).not.toHaveProperty("sourceUnitBasis");
  });
});

describe("unitCheck with a source unit conflict", () => {
  const attribute = (claims: SpecClaim[]): SpecAttribute => ({
    key: "max_payload",
    label: "Max payload",
    unit: "kg",
    canonicalUnit: "kg",
    claims,
    discoveredBy: "seed",
  });

  it("fails a claim whose extractor unit and quote disagree", () => {
    const c = claim({ evidence: "weighs 105 lbs", sourceUnit: "kg" });
    const result = unitCheck(attribute([c]), c, "2026-01-01T00:00:00.000Z");
    expect(result).toMatchObject({ kind: "unit_dimension", verdict: "fail", applicable: true });
    expect(result.detail).toBe("extractor unit and quote disagree (extractor: kg, quote: lb)");
  });

  it("fails a stored conflict", () => {
    const c = claim({ evidence: "weighs 105 lbs", sourceUnitBasis: "conflict" });
    expect(unitCheck(attribute([c]), c, "2026-01-01T00:00:00.000Z").verdict).toBe("fail");
  });

  it("does not call a bare figure with no source unit a conflict", () => {
    const c = claim();
    expect(unitCheck(attribute([c]), c, "2026-01-01T00:00:00.000Z").detail).not.toContain(
      "disagree",
    );
  });
});
