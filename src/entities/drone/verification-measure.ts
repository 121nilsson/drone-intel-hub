import { claimSourceUnit } from "@/entities/normalization/claim-source-unit";
import { canonicalUnitForSemantic } from "@/entities/normalization/semantic";
import { canonicalUnitFor, convert, normalizeQuantityLoose } from "@/entities/normalization/units";
import { plausibleBounds } from "./auto-correction";
import { correctedPoint } from "./claim-review";
import { rawPoint } from "./consensus";
import { attributeSemantic } from "./spec-engine";
import { expectedUnit, feedsNumbers, unitStanding } from "./unit-policy";
import type { FlightProfile, SpecAttribute, SpecClaim, VerificationCheck } from "./types";
import { check } from "./verification-check";

const inBounds = (value: number, bounds: { min: number; max: number }) =>
  value >= bounds.min && value <= bounds.max;

/** The claim's own reading, parsed from `normalized`, `raw` or the stored value plus spec unit. */
function reading(claim: SpecClaim, spec: SpecAttribute) {
  // The attribute says what a "g" is: a load factor reads as one, never as grams.
  const ctx = { semantic: attributeSemantic(spec) };
  // A stored reading without a unit is a bare number; the attribute's unit may still say what it is.
  // One stored before the attribute was known as a load factor holds "4g" as 0.004 kg: it is read again.
  const stale =
    ctx.semantic.startsWith("maneuver.load_factor") && claim.normalized?.canonicalUnit !== "g_load";
  if (claim.normalized?.canonicalUnit && !stale) return claim.normalized;
  const stated = claim.raw?.trim() || String(claim.value ?? "").trim();
  const parsed = stated ? normalizeQuantityLoose(stated, ctx) : undefined;
  if (parsed?.canonicalUnit) return parsed;
  // A bare figure - "240" under a Calibre in mm, stored as text or as a number - is in the
  // attribute's unit: that is what the attribute's unit means.
  const bare = (s: string) => /^[\s\d.,–—~≈<>≤≥+-]+$/.test(s);
  if (spec.unit) {
    if (bare(stated)) {
      const withUnit = normalizeQuantityLoose(`${stated} ${spec.unit}`, ctx);
      if (withUnit) return withUnit;
    }
    // Raw wording the parser cannot read ("endurance of 30 days"): the stored figure is enough.
    const value = String(claim.value ?? "").trim();
    if (value && bare(value)) {
      const withUnit = normalizeQuantityLoose(`${value} ${spec.unit}`, ctx);
      if (withUnit) return withUnit;
    }
  }
  return parsed ?? (stale ? undefined : claim.normalized);
}

export function unitCheck(spec: SpecAttribute, claim: SpecClaim, at: string): VerificationCheck {
  // The extractor's unit and the source text name different units: no unit is chosen, and a
  // figure whose unit is disputed does not pass as measured in the attribute's unit.
  const source = claimSourceUnit(claim);
  if (source.basis === "conflict") {
    const d = source.disagreement;
    return check({
      kind: "unit_dimension",
      verdict: "fail",
      applicable: true,
      confidence: 1,
      detail: d
        ? `extractor unit and ${d.basis === "quote" ? "quote" : "value text"} disagree (extractor: ${d.extractor}, ${d.basis === "quote" ? "quote" : "value"}: ${d.evidenced})`
        : "extractor unit and source text disagree",
      at,
    });
  }
  const expected = expectedUnit(spec);
  if (!expected)
    return check({
      kind: "unit_dimension",
      verdict: "uncertain",
      applicable: false,
      detail: "attribute has no canonical measurement unit",
      at,
    });
  // No unit is evidenced for this figure: the text does not give one, or only the extractor says
  // which. It is not wrong - it cannot be judged - so it is uncertain, never a pass.
  const standing = unitStanding(spec, claim);
  if (standing === "unknown" || standing === "unverified")
    return check({
      kind: "unit_dimension",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.3,
      detail:
        standing === "unverified"
          ? "the unit is the extractor's; the source text does not confirm it"
          : "no unit is given for this figure in the source text",
      at,
    });
  const parsed = reading(claim, spec);
  if (!parsed?.canonicalUnit) {
    const numeric = typeof claim.value === "number" || Number.isFinite(Number(claim.raw));
    return check({
      kind: "unit_dimension",
      verdict: "uncertain",
      applicable: numeric,
      confidence: 0.3,
      detail: numeric ? "value has no unit to check" : "value is not a measurement",
      at,
    });
  }
  // By dimension: a length is read into kilometres, the distance canonical, while a calibre is
  // shown in millimetres and a hull in metres - the same measurement, not a wrong one.
  if (parsed.canonicalUnit !== expected && parsed.canonicalUnit !== canonicalUnitFor(expected))
    return check({
      kind: "unit_dimension",
      verdict: "fail",
      applicable: true,
      confidence: 1,
      detail: `read as ${parsed.canonicalUnit}, but the attribute is measured in ${expected}`,
      at,
    });
  return check({
    kind: "unit_dimension",
    verdict: "pass",
    applicable: true,
    confidence: 1,
    detail: `measured in ${expected}`,
    at,
  });
}

/** Point or range readings in the bounds' unit, or undefined when there is nothing to bound. */
function boundValues(spec: SpecAttribute, claim: SpecClaim, unit: string): number[] | undefined {
  const fixed = correctedPoint(claim);
  const point = fixed ?? rawPoint(spec, claim);
  if (point) {
    if (!point.unit || point.unit === unit) return [point.value];
    const converted = convert(point.value, point.unit, unit);
    return converted === undefined ? undefined : [converted];
  }
  const range = claim.normalized?.range;
  const from = claim.normalized?.canonicalUnit;
  if (!range || !from) return undefined;
  const values = [range.min, range.max].flatMap((v) => {
    if (v === undefined) return [];
    const converted = from === unit ? v : convert(v, from, unit);
    return converted === undefined ? [] : [converted];
  });
  return values.length ? values : undefined;
}

export function boundsCheck(
  spec: SpecAttribute,
  claim: SpecClaim,
  at: string,
  profile?: FlightProfile,
): VerificationCheck {
  const semantic = attributeSemantic(spec);
  // A figure whose unit is not evidenced has no scale to hold against the bounds.
  if (!feedsNumbers(unitStanding(spec, claim)))
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: "the figure's unit is not evidenced, so it cannot be held against bounds",
      at,
    });
  const bounds = plausibleBounds(semantic, profile);
  if (!bounds)
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: "no plausibility bounds for this attribute",
      at,
    });
  const unit = expectedUnit(spec);
  if (unit && unit !== bounds.unit)
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: `bounds are stated in ${bounds.unit}, attribute in ${unit}`,
      at,
    });
  const values = boundValues(spec, claim, bounds.unit);
  if (!values)
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: "no point or range reading to bound",
      at,
    });
  const outside = values.filter((v) => !inBounds(v, bounds));
  if (!outside.length)
    return check({
      kind: "bounds",
      verdict: "pass",
      applicable: true,
      confidence: 0.9,
      detail: `within ${bounds.min}–${bounds.max} ${bounds.unit}`,
      at,
    });

  const fix = claim.autoCorrection;
  if (fix?.kind === "unit" && fix.applied)
    return check({
      kind: "bounds",
      verdict: "pass",
      applicable: true,
      confidence: 0.9,
      detail: `unit slip corrected to ${fix.value} ${fix.unit ?? bounds.unit}`,
      at,
    });
  if (fix?.kind === "unit" && fix.value !== undefined && inBounds(fix.value, bounds))
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.4,
      detail: `outside ${bounds.min}–${bounds.max} ${bounds.unit}; a unit correction to ${fix.value} ${fix.unit ?? bounds.unit} is proposed`,
      at,
    });
  if (fix?.kind === "implausible")
    return check({
      kind: "bounds",
      verdict: "fail",
      applicable: true,
      confidence: 1,
      detail: `outside what the catalogue accepts for ${semantic} (${bounds.min}–${bounds.max} ${bounds.unit})`,
      at,
    });
  return check({
    kind: "bounds",
    verdict: "fail",
    applicable: true,
    confidence: 1,
    detail: `outside what the catalogue accepts for ${semantic} (${bounds.min}–${bounds.max} ${bounds.unit})`,
    at,
  });
}
