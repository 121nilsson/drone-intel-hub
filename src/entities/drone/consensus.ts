import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import { convert, normalizeQuantity, normalizeQuantityLoose } from "@/entities/normalization/units";
import { parseMoney, parseMoneyRange } from "@/entities/normalization/currency";
import { leadingQualifier, parseRange } from "@/entities/normalization/numeric";
import { claimCounts, correctedPoint } from "./claim-review";
import type { SpecAttribute, SpecClaim } from "./types";

function targetUnit(spec: SpecAttribute): string | undefined {
  if (spec.canonicalUnit) return spec.canonicalUnit;
  if (spec.semantic) return canonicalUnitForSemantic(spec.semantic);
  const inferred = semanticKeyFor(spec.key, spec.label);
  if (inferred.startsWith("dimension.")) return canonicalUnitForSemantic(inferred);
  return undefined;
}

function alignUnit(
  value: number,
  unit: string,
  spec: SpecAttribute,
): { value: number; unit: string } {
  const target = targetUnit(spec);
  if (!target || unit === target) return { value, unit };
  const converted = convert(value, unit, target);
  return converted !== undefined ? { value: converted, unit: target } : { value, unit };
}

export interface Consensus {
  display: string;
  min?: number;
  max?: number;
  median?: number;
  /** (max − min) / median across point values. Bounds are not part of this ratio. */
  spreadPct?: number;
  /** Indexes of point claims that sit at least 60% away from the median. */
  outliers?: number[];
  sources: number;
  /** Sources materially disagree - the display shows the observed range. */
  disputed: boolean;
  confidence: "high" | "medium" | "low";
}

interface Point {
  value: number;
  unit?: string;
  claimIndex: number;
}

interface Bound {
  min?: number;
  max?: number;
  unit?: string;
}

function measurement(
  spec: SpecAttribute,
  claim: SpecClaim,
  claimIndex: number,
): Point | Bound | undefined {
  const semantic = spec.semantic ?? semanticKeyFor(spec.key, spec.label);
  // A price stated in words ("7000 доларів", "5–7 тисяч доларів") is money, not a measurement:
  // read it with its currency, or the row shows the source's wording.
  if (semantic === "cost.unit" && typeof claim.value === "string") {
    const span = parseMoneyRange(claim.value);
    if (span) return { min: span.min, max: span.max, unit: span.currency };
    const money = parseMoney(claim.value);
    if (money) {
      // "more than $50 million" is a floor, not a price.
      const { qualifier } = leadingQualifier(claim.value);
      if (qualifier === "at_least" || qualifier === "greater_than")
        return { min: money.amount, unit: money.currency };
      if (qualifier === "up_to" || qualifier === "less_than")
        return { max: money.amount, unit: money.currency };
      return { value: money.amount, unit: money.currency, claimIndex };
    }
  }
  // A claim stored before its wording could be read ("щонайменше 3,5 години") is read again
  // here, so a reader fix reaches stored claims too - bounds as well as points.
  const parsed =
    claim.normalized ??
    (typeof claim.value === "string"
      ? (normalizeQuantityLoose(claim.value) ??
        // The spec's unit is lent only to a bare figure or bound ("до 300"): appended to prose
        // ("12 drones + 12 mines") it would read a count as a mass.
        (spec.unit && parseRange(claim.value)
          ? normalizeQuantityLoose(`${claim.value} ${spec.unit}`)
          : undefined))
      : undefined);
  if (parsed) {
    const qual = parsed.range?.qualifier ?? "exact";
    if ((qual === "exact" || qual === "approximate") && parsed.canonicalValue !== undefined) {
      const unit = parsed.canonicalUnit ?? "";
      const aligned = unit
        ? alignUnit(parsed.canonicalValue, unit, spec)
        : { value: parsed.canonicalValue, unit: "" };
      return { value: aligned.value, ...(aligned.unit ? { unit: aligned.unit } : {}), claimIndex };
    }
    if (parsed.range && (parsed.range.min !== undefined || parsed.range.max !== undefined)) {
      const unit = parsed.canonicalUnit ?? "";
      const min =
        parsed.range.min !== undefined && unit
          ? alignUnit(parsed.range.min, unit, spec).value
          : parsed.range.min;
      const max =
        parsed.range.max !== undefined && unit
          ? alignUnit(parsed.range.max, unit, spec).value
          : parsed.range.max;
      const displayUnit = unit
        ? alignUnit(parsed.range.min ?? parsed.range.max ?? 0, unit, spec).unit
        : unit;
      return {
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(displayUnit ? { unit: displayUnit } : {}),
      };
    }
  }
  if (typeof claim.value !== "number") {
    // A value may carry its own unit ("0.8 Mach", "45,000 feet", "0.8 Маха"), so it is read
    // on its own before the spec's unit is tried. A claim the reader cannot read is a claim
    // that never counts, and the row then shows whatever spelling the source used.
    const own = normalizeQuantityLoose(String(claim.value));
    const withSpec = spec.unit ? normalizeQuantityLoose(`${claim.value} ${spec.unit}`) : undefined;
    const converted = own ?? withSpec;
    if (converted?.canonicalValue !== undefined) {
      const unit = converted.canonicalUnit ?? "";
      const aligned = unit
        ? alignUnit(converted.canonicalValue, unit, spec)
        : { value: converted.canonicalValue, unit: "" };
      return {
        value: aligned.value,
        ...(aligned.unit ? { unit: aligned.unit } : {}),
        claimIndex,
      };
    }
    const numeric = Number(claim.value);
    if (Number.isFinite(numeric)) {
      return { value: numeric, ...(spec.unit ? { unit: spec.unit } : {}), claimIndex };
    }
    return undefined;
  }
  if (spec.unit) {
    const converted = normalizeQuantityLoose(`${claim.value} ${spec.unit}`);
    if (converted?.canonicalValue !== undefined) {
      const unit = converted.canonicalUnit ?? "";
      const aligned = unit
        ? alignUnit(converted.canonicalValue, unit, spec)
        : { value: converted.canonicalValue, unit: "" };
      return {
        value: aligned.value,
        ...(aligned.unit ? { unit: aligned.unit } : {}),
        claimIndex,
      };
    }
  }
  // A unit_cost figure stored as a bare number keeps its currency in the source text
  // ("$50,000 per unit" → value 50000, no unit on the claim). Read it from raw/evidence
  // so the display carries the currency instead of a naked figure.
  if (semantic === "cost.unit") {
    const money = parseMoney(claim.raw ?? claim.evidence ?? "");
    if (money) {
      return { value: claim.value, unit: money.currency, claimIndex };
    }
  }
  return { value: claim.value, ...(spec.unit ? { unit: spec.unit } : {}), claimIndex };
}

function isPoint(m: Point | Bound): m is Point {
  return "value" in m;
}

/**
 * A claim's own point reading, in the unit consensus measures this spec in, before any
 * correction. Undefined for ranges, bounds and text.
 */
export function rawPoint(
  spec: SpecAttribute,
  claim: SpecClaim,
): { value: number; unit?: string } | undefined {
  const m = measurement(spec, claim, 0);
  return m && isPoint(m) ? { value: m.value, ...(m.unit ? { unit: m.unit } : {}) } : undefined;
}

/**
 * Trim float noise (2000.0000000000002) without hiding meaningful precision (2.35).
 *
 * Two decimals is the display's precision, but on a small figure those decimals can be a
 * large error - 0.0091 km (9.1 m) would read as 0.01 km - so three significant digits are kept
 * whenever the decimals would eat the number.
 */
function round(n: number) {
  if (Number.isInteger(n)) return n;
  const fixed = Number(n.toFixed(2));
  if (fixed === 0 || Math.abs(fixed - n) > Math.abs(n) * 0.01) return Number(n.toPrecision(3));
  return fixed;
}

/**
 * The unit a figure is shown in. Durations are stored in minutes, but "210 min" or "1440 min"
 * has to be worked out by the reader, so from two hours a duration reads in hours, and from
 * three days in days. Only the display changes; min, max and median stay in the stored unit.
 */
function displayScale(unit: string | undefined, magnitude: number) {
  if (unit === "min" && Math.abs(magnitude) >= 4320) return { factor: 1440, suffix: " d" };
  if (unit === "min" && Math.abs(magnitude) >= 120) return { factor: 60, suffix: " h" };
  return { factor: 1, suffix: unit ? ` ${unit}` : "" };
}

export function consensus(spec: SpecAttribute): Consensus {
  // An adjudicated "outlier" or an analyst-rejected claim stays on the record (the report said
  // what it said) but no longer feeds the aggregate: one rejected figure must not drag the
  // median into a dispute. Kept claims carry their original index, so consensus().outliers
  // still points into spec.claims.
  const kept = spec.claims.flatMap((claim, i) => (claimCounts(claim) ? [{ claim, i }] : []));
  const sources = new Set(kept.map(({ claim }) => claim.source)).size;
  const measured = kept.flatMap(({ claim, i }) => {
    // A corrected reading is already in the spec's unit (rawPoint is what it was derived from).
    const fixed = correctedPoint(claim);
    if (fixed) return [{ ...fixed, claimIndex: i }];
    const m = measurement(spec, claim, i);
    return m ? [m] : [];
  });
  // Prices in two currencies have no common scale without an exchange rate: a median of SEK and
  // USD is neither. A price that cannot be read ("40 million Swedish krona") may be just such a
  // second currency, so it does not drop out silently either. Such a row keeps the sources'
  // own wording.
  const unreadablePrices =
    (spec.semantic ?? semanticKeyFor(spec.key, spec.label)) === "cost.unit" &&
    (measured.length < kept.length || new Set(measured.map((m) => m.unit ?? "")).size > 1);
  const readable = unreadablePrices ? [] : measured;
  const points = readable.filter(isPoint).sort((a, b) => a.value - b.value);
  const bounds = readable.filter((m): m is Bound => !isPoint(m));

  if (points.length === 0 && bounds.length === 0) {
    const counts = new Map<string, number>();
    kept.forEach(({ claim }) =>
      counts.set(String(claim.value), (counts.get(String(claim.value)) ?? 0) + 1),
    );
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const agree = top ? top[1] / kept.length : 0;
    return {
      display: top?.[0] ?? "—",
      sources,
      disputed: agree < 0.6 && kept.length > 1,
      confidence: sources >= 3 && agree > 0.6 ? "high" : sources >= 2 ? "medium" : "low",
    };
  }

  if (points.length === 0) {
    const mins = bounds.flatMap((b) => (b.min !== undefined ? [b.min] : []));
    const maxs = bounds.flatMap((b) => (b.max !== undefined ? [b.max] : []));
    const unit = bounds.find((b) => b.unit)?.unit;
    const min = mins.length ? Math.min(...mins) : undefined;
    const max = maxs.length ? Math.max(...maxs) : undefined;
    const { factor, suffix } = displayScale(unit, max ?? min ?? 0);
    const show = (n: number) => round(n / factor);
    const display =
      min !== undefined && max !== undefined
        ? `${show(min)}–${show(max)}${suffix}`
        : max !== undefined
          ? `≤${show(max)}${suffix}`
          : min !== undefined
            ? `≥${show(min)}${suffix}`
            : "—";
    return {
      display,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      sources,
      disputed: false,
      confidence: "low",
    };
  }

  const nums = points.map((p) => p.value);
  const minPoint = nums[0]!;
  const maxPoint = nums[nums.length - 1]!;
  const median = nums[Math.floor(nums.length / 2)]!;
  const spread = median ? (maxPoint - minPoint) / median : 0;
  const envelopeMin = Math.min(
    minPoint,
    ...bounds.flatMap((b) => (b.min !== undefined ? [b.min] : [])),
  );
  const envelopeMax = Math.max(
    maxPoint,
    ...bounds.flatMap((b) => (b.max !== undefined ? [b.max] : [])),
  );
  const confidence =
    sources >= 3 && spread < 0.25 ? "high" : sources >= 2 && spread < 0.6 ? "medium" : "low";
  const unit = targetUnit(spec) ?? points.find((p) => p.unit)?.unit ?? spec.unit;
  const disputed = spread >= 0.6 && sources >= 2;
  const { factor, suffix: u } = displayScale(unit, disputed ? envelopeMax : median);
  const show = (n: number) => round(n / factor);
  const outliers = points
    .filter((p) => median !== 0 && Math.abs(p.value - median) / Math.abs(median) >= 0.6)
    .map((p) => p.claimIndex);
  return {
    display: disputed ? `${show(envelopeMin)}–${show(envelopeMax)}${u}` : `${show(median)}${u}`,
    min: envelopeMin,
    max: envelopeMax,
    median,
    spreadPct: spread,
    ...(outliers.length ? { outliers } : {}),
    sources,
    disputed,
    confidence,
  };
}
