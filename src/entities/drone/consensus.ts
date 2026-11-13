import { canonicalUnitForSemantic, semanticKeyFor } from "@/entities/normalization/semantic";
import {
  convert,
  displayUnit,
  normalizeQuantity,
  normalizeQuantityLoose,
} from "@/entities/normalization/units";
import { parseMoney, parseMoneyRange } from "@/entities/normalization/currency";
import {
  leadingQualifier,
  parseRange,
  type QuantityQualifier,
} from "@/entities/normalization/numeric";
import { toleranceFor, type AttributeTolerance } from "@/entities/normalization/core-registry";
import { claimCounts, claimKey, correctedPoint } from "./claim-review";
import { clusterObservations } from "./verification-sources";
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

/**
 * One source's own statement of a figure as a range or a bound, kept with who said it. The
 * numbers are on the attribute's canonical unit; a missing end is open.
 */
export interface ExplicitSourceRange {
  claimId: string;
  sourceId?: string;
  source: string;
  /** The source's wording, verbatim. */
  rawValue: string;
  /** The unit the source wrote the figure in, when it did. */
  rawUnit?: string;
  /** Keeps the source's strength: "up to 100" is not "100". */
  kind: Exclude<QuantityQualifier, "exact" | "approximate">;
  min?: number;
  max?: number;
  canonicalUnit: string;
  /**
   * Where the unit comes from: "value_text" when the figure's own text carries it, "quote" when
   * the source's quote does. Claims with neither get no entry, since their numbers have no unit.
   */
  unitBasis: "value_text" | "quote";
}

export interface Consensus {
  /**
   * What a reader sees. Non-disputed: the median (or the range or bound a single source gave).
   * Disputed: the median as well, flagged by `disputed` - never the envelope.
   */
  display: string;
  /**
   * The envelope over every counted observation, kept for compatibility. It mixes sources and
   * bounds, so it must never be rendered as a source's range: use `explicitRanges` and
   * `observedSpread` for that.
   */
  min?: number;
  max?: number;
  /** Median of the observations' central values: a point, or the midpoint of a range. */
  median?: number;
  /**
   * (max − min) / |median| across point values. Ranges and bounds are not part of this ratio. Zero
   * when the median is zero.
   */
  spreadPct?: number;
  /** Indexes of point claims that sit at least 60% away from the median. */
  outliers?: number[];
  /** Distinct sources, where sources that repeat one post or one outlet count once. */
  sources: number;
  /** Sources materially disagree beyond the attribute's tolerance (see core-registry). */
  disputed: boolean;
  confidence: "high" | "medium" | "low";
  /** One entry per counted source that states a range or a bound. */
  explicitRanges?: ExplicitSourceRange[];
  /** Spread between point readings only. Present when at least two point readings differ. */
  observedSpread?: { min: number; max: number };
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
  qualifier?: QuantityQualifier;
}

function measurement(
  spec: SpecAttribute,
  claim: SpecClaim,
  claimIndex: number,
): Point | Bound | undefined {
  const semantic = spec.semantic ?? semanticKeyFor(spec.key, spec.label);
  // The attribute's semantic decides how a bare "g" reads: a load factor, or grams.
  const ctx = { semantic };
  // A price stated in words ("7000 доларів", "5–7 тисяч доларів") is money, not a measurement:
  // read it with its currency, or the row shows the source's wording.
  if (semantic === "cost.unit" && typeof claim.value === "string") {
    const span = parseMoneyRange(claim.value);
    if (span) return { min: span.min, max: span.max, unit: span.currency, qualifier: "range" };
    const money = parseMoney(claim.value);
    if (money) {
      // "more than $50 million" is a floor, not a price.
      const { qualifier } = leadingQualifier(claim.value);
      if (qualifier === "at_least" || qualifier === "greater_than")
        return { min: money.amount, unit: money.currency, qualifier };
      if (qualifier === "up_to" || qualifier === "less_than")
        return { max: money.amount, unit: money.currency, qualifier };
      return { value: money.amount, unit: money.currency, claimIndex };
    }
  }
  // A claim stored before its wording could be read ("щонайменше 3,5 години") is read again
  // here, so a reader fix reaches stored claims too - bounds as well as points.
  const parsed =
    claim.normalized ??
    (typeof claim.value === "string"
      ? (normalizeQuantityLoose(claim.value, ctx) ??
        // The spec's unit is lent only to a bare figure or bound ("до 300"): appended to prose
        // ("12 drones + 12 mines") it would read a count as a mass.
        (spec.unit && parseRange(claim.value)
          ? normalizeQuantityLoose(`${claim.value} ${spec.unit}`, ctx)
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
        qualifier: qual,
      };
    }
  }
  if (typeof claim.value !== "number") {
    // A value may carry its own unit ("0.8 Mach", "45,000 feet", "0.8 Маха"), so it is read
    // on its own before the spec's unit is tried. A claim the reader cannot read is a claim
    // that never counts, and the row then shows whatever spelling the source used.
    const own = normalizeQuantityLoose(String(claim.value), ctx);
    const withSpec = spec.unit
      ? normalizeQuantityLoose(`${claim.value} ${spec.unit}`, ctx)
      : undefined;
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
    const converted = normalizeQuantityLoose(`${claim.value} ${spec.unit}`, ctx);
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
export function displayScale(unit: string | undefined, magnitude: number) {
  if (unit === "min" && Math.abs(magnitude) >= 4320) return { factor: 1440, suffix: " d" };
  if (unit === "min" && Math.abs(magnitude) >= 120) return { factor: 60, suffix: " h" };
  // g_load is the internal name of a load factor; people read it as "g".
  return { factor: 1, suffix: unit ? ` ${displayUnit(unit)}` : "" };
}

/** One counted source's reading, with the claim that carries it. */
interface Reading {
  m: Point | Bound;
  claim: SpecClaim;
  /** Index of the claim in spec.claims. */
  index: number;
}

/** A reading on the canonical unit as an interval. An open end is infinite. */
interface Interval {
  lo: number;
  hi: number;
}

function intervalOf(m: Point | Bound): Interval {
  if (isPoint(m)) return { lo: m.value, hi: m.value };
  return { lo: m.min ?? -Infinity, hi: m.max ?? Infinity };
}

/** A point is its value and a range its midpoint. An open bound has no central value. */
function centralOf(m: Point | Bound): number | undefined {
  if (isPoint(m)) return m.value;
  return m.min !== undefined && m.max !== undefined ? (m.min + m.max) / 2 : undefined;
}

/** The gap between two readings: 0 when they overlap, otherwise the distance between them. */
function gapBetween(a: Interval, b: Interval): number {
  // Never NaN: a lower end is never +Infinity and an upper end is never -Infinity.
  return Math.max(0, a.lo - b.hi, b.lo - a.hi);
}

/**
 * True when some two readings are at least `tau` apart. tau is the attribute's relative tolerance
 * applied to the central value, floored by the absolute tolerance, so a median near zero does not
 * turn every small difference into a dispute. A zero gap is never a dispute, even at zero tolerance.
 */
function disputedAt(
  intervals: readonly Interval[],
  central: number,
  tol: AttributeTolerance,
): boolean {
  if (intervals.length < 2) return false;
  const tau = Math.max(tol.rel * Math.abs(central), tol.abs);
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const gap = gapBetween(intervals[i]!, intervals[j]!);
      if (gap > 0 && gap >= tau) return true;
    }
  }
  return false;
}

/**
 * A source's own range or bound, kept as that source stated it. Only claims whose unit the source
 * actually wrote qualify: a bare figure read in the attribute's unit gives no canonical number a
 * reader can rely on.
 */
function explicitRangeOf(reading: Reading, semantic: string): ExplicitSourceRange | undefined {
  const { m, claim } = reading;
  if (isPoint(m)) return undefined;
  const kind = m.qualifier;
  const canonicalUnit = m.unit;
  if (!kind || kind === "exact" || kind === "approximate" || canonicalUnit === undefined) {
    return undefined;
  }
  const rawValue = claim.raw ?? String(claim.value);
  const textCarriesUnit =
    normalizeQuantityLoose(rawValue, { semantic })?.unit !== undefined ||
    parseMoney(rawValue) !== undefined ||
    parseMoneyRange(rawValue) !== undefined;
  const unitBasis = textCarriesUnit
    ? "value_text"
    : claim.sourceUnitBasis === "quote" && claim.sourceUnit
      ? "quote"
      : undefined;
  if (!unitBasis) return undefined;
  const rawUnit = claim.sourceUnit ?? claim.normalized?.unit;
  return {
    claimId: claimKey(claim),
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    source: claim.source,
    rawValue,
    ...(rawUnit ? { rawUnit } : {}),
    kind,
    ...(m.min !== undefined ? { min: m.min } : {}),
    ...(m.max !== undefined ? { max: m.max } : {}),
    canonicalUnit,
    unitBasis,
  };
}

export function consensus(spec: SpecAttribute): Consensus {
  // An adjudicated "outlier" or an analyst-rejected claim stays on the record (the report said
  // what it said) but no longer feeds the aggregate: one rejected figure must not drag the
  // median into a dispute. Kept claims carry their original index, so consensus().outliers
  // still points into spec.claims.
  const kept = spec.claims.flatMap((claim, i) => (claimCounts(claim) ? [{ claim, i }] : []));
  const indexOf = new Map<SpecClaim, number>(kept.map(({ claim, i }) => [claim, i]));
  // One observation per outlet or repost cluster, stated by the cluster's latest claim. An outlet
  // that restated its figure counts once, with the restated figure; a wire text carried by two
  // outlets counts once, whatever figure each of them printed.
  const observed = clusterObservations(kept.map(({ claim }) => claim)).map((cluster) => {
    const claim = cluster.reduce((latest, c) => (c.date > latest.date ? c : latest));
    return { claim, index: indexOf.get(claim)! };
  });
  const sources = observed.length;
  const readings: Reading[] = observed.flatMap(({ claim, index }) => {
    // A corrected reading is already in the spec's unit (rawPoint is what it was derived from).
    const fixed = correctedPoint(claim);
    const m = fixed ? { ...fixed, claimIndex: index } : measurement(spec, claim, index);
    return m ? [{ m, claim, index }] : [];
  });
  const semantic = spec.semantic ?? semanticKeyFor(spec.key, spec.label);
  // Prices in two currencies have no common scale without an exchange rate: a median of SEK and
  // USD is neither. A price that cannot be read ("40 million Swedish krona") may be just such a
  // second currency, so it does not drop out silently either. Such a row keeps the sources'
  // own wording.
  const unreadablePrices =
    semantic === "cost.unit" &&
    (readings.length < observed.length || new Set(readings.map((r) => r.m.unit ?? "")).size > 1);
  const readable = unreadablePrices ? [] : readings;
  // Each source's own range or bound is shown per source, never merged into one range.
  const explicitRanges = readings.flatMap((r) => {
    const entry = explicitRangeOf(r, semantic);
    return entry ? [entry] : [];
  });
  const explicit = explicitRanges.length ? { explicitRanges } : {};

  if (readable.length === 0) {
    const counts = new Map<string, number>();
    observed.forEach(({ claim }) =>
      counts.set(String(claim.value), (counts.get(String(claim.value)) ?? 0) + 1),
    );
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const agree = top ? top[1] / sources : 0;
    return {
      display: top?.[0] ?? "—",
      sources,
      disputed: agree < 0.6 && sources > 1,
      confidence: sources >= 3 && agree > 0.6 ? "high" : sources >= 2 ? "medium" : "low",
      ...explicit,
    };
  }

  const pointReadings = readable.filter((r): r is Reading & { m: Point } => isPoint(r.m));
  const hasPoints = pointReadings.length > 0;
  const intervals = readable.map((r) => intervalOf(r.m));
  const mids = readable.flatMap((r) => {
    const c = centralOf(r.m);
    return c === undefined ? [] : [c];
  });
  mids.sort((a, b) => a - b);
  // Without a point or a range there is no median; the central value of a bound-only group is the
  // median of the figures its bounds name, which is what the tolerance is measured from.
  const endpoints = intervals
    .flatMap((iv) => [iv.lo, iv.hi])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const central = mids.length
    ? mids[Math.floor(mids.length / 2)]!
    : endpoints[Math.floor(endpoints.length / 2)]!;

  // The envelope over every reading, kept for compatibility. It is never a source's range.
  const finiteLows = intervals.map((iv) => iv.lo).filter(Number.isFinite);
  const finiteHighs = intervals.map((iv) => iv.hi).filter(Number.isFinite);
  const envMin = finiteLows.length ? Math.min(...finiteLows) : undefined;
  const envMax = finiteHighs.length ? Math.max(...finiteHighs) : undefined;

  const disputed = disputedAt(intervals, central, toleranceFor(semantic));
  const unit = hasPoints
    ? (targetUnit(spec) ?? pointReadings.find((r) => r.m.unit)?.m.unit ?? spec.unit)
    : readable.find((r) => r.m.unit)?.m.unit;
  const { factor, suffix } = displayScale(
    unit,
    hasPoints || disputed || mids.length > 0 ? central : (envMax ?? envMin ?? 0),
  );
  const show = (n: number) => round(n / factor);
  // What is shown is something a source said, or a central figure. The envelope over several
  // readings ("20–40 kW" out of 20–35 and 25–40, "20–100 km" out of "at least 20" and "up to 100")
  // is a span no source stated, so it is never the display:
  //  - one reading, or readings that are all the same interval: that interval as it was written;
  //  - several readings with a point or a range among them: the central value, each source's own
  //    range staying in `explicitRanges`;
  //  - bounds only: the loosest lower and the loosest upper bound a source stated, as two separate
  //    statements ("≥20 · ≤100"), never as a span.
  // A dispute is shown by its flag.
  const sameInterval = intervals.every(
    (iv) => iv.lo === intervals[0]!.lo && iv.hi === intervals[0]!.hi,
  );
  const lowerBounds = intervals.filter((iv) => Number.isFinite(iv.lo) && !Number.isFinite(iv.hi));
  const upperBounds = intervals.filter((iv) => !Number.isFinite(iv.lo) && Number.isFinite(iv.hi));
  const loosestLower = lowerBounds.length ? Math.min(...lowerBounds.map((iv) => iv.lo)) : undefined;
  const loosestUpper = upperBounds.length ? Math.max(...upperBounds.map((iv) => iv.hi)) : undefined;
  const boundsOnly = !hasPoints && mids.length === 0;
  const asWritten = () =>
    envMin !== undefined && envMax !== undefined
      ? `${show(envMin)}–${show(envMax)}${suffix}`
      : envMax !== undefined
        ? `≤${show(envMax)}${suffix}`
        : envMin !== undefined
          ? `≥${show(envMin)}${suffix}`
          : "—";
  const display = hasPoints
    ? `${show(central)}${suffix}`
    : readable.length === 1 || sameInterval
      ? asWritten()
      : boundsOnly
        ? loosestLower !== undefined && loosestUpper !== undefined
          ? `≥${show(loosestLower)}${suffix} · ≤${show(loosestUpper)}${suffix}`
          : asWritten()
        : `${show(central)}${suffix}`;

  if (!hasPoints) {
    // "At least 100" with "up to 10" would put the lower figure above the higher one.
    const lo = envMin !== undefined && envMax !== undefined ? Math.min(envMin, envMax) : envMin;
    const hi = envMin !== undefined && envMax !== undefined ? Math.max(envMin, envMax) : envMax;
    return {
      display,
      ...(lo !== undefined ? { min: lo } : {}),
      ...(hi !== undefined ? { max: hi } : {}),
      ...(mids.length ? { median: central } : {}),
      sources,
      disputed,
      confidence: "low",
      ...explicit,
    };
  }

  // The spread and the outliers are about the point readings, as they always were.
  const pointValues = pointReadings.map((r) => r.m.value);
  const pointSorted = [...pointValues].sort((a, b) => a - b);
  const pointMin = pointSorted[0]!;
  const pointMax = pointSorted[pointSorted.length - 1]!;
  const pointMedian = pointSorted[Math.floor(pointSorted.length / 2)]!;
  const spread = pointMedian ? (pointMax - pointMin) / Math.abs(pointMedian) : 0;
  const confidence = disputed
    ? "low"
    : sources >= 3 && spread < 0.25
      ? "high"
      : sources >= 2 && spread < 0.6
        ? "medium"
        : "low";
  const outliers = pointReadings
    .filter((r) => central !== 0 && Math.abs(r.m.value - central) / Math.abs(central) >= 0.6)
    .map((r) => r.index);
  // Separate from the envelope: the spread between point readings alone, so a reader can see how
  // far the point sources differ without a range or bound being taken for a source's own figure.
  const observedSpread =
    pointValues.length >= 2 && pointMin !== pointMax ? { min: pointMin, max: pointMax } : undefined;
  return {
    display,
    min: envMin!,
    max: envMax!,
    median: central,
    spreadPct: spread,
    ...(outliers.length ? { outliers } : {}),
    ...(observedSpread ? { observedSpread } : {}),
    ...explicit,
    sources,
    disputed,
    confidence,
  };
}
