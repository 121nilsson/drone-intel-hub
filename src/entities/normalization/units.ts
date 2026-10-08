import { parseRange, type QuantityRange } from "./numeric";

export const CANONICAL_UNIT = {
  distance: "km",
  speed: "km/h",
  mass: "kg",
  duration: "min",
} as const;

export type Dimension = keyof typeof CANONICAL_UNIT;

export interface NormalizedQuantity {
  raw: string;
  /** Point value in the raw unit. Absent for bounds and ranges. */
  value?: number;
  /** Unit token as classified, e.g. "mi". */
  unit?: string;
  /** Set only for an exact or approximate point, already converted. */
  canonicalValue?: number;
  canonicalUnit?: string;
  range?: QuantityRange;
  /** 1 when the unit and a point value are explicit; lower when a magnitude suffix was used. */
  confidence: number;
}

/** Statute mile in kilometres (international). */
const MILE_KM = 1.609344;
/** Nautical mile in kilometres. */
const NM_KM = 1.852;
const LB_KG = 0.45359237;
const OZ_KG = 0.028349523125;

interface UnitDef {
  token: string;
  dimension: Dimension;
  /** Multiply a value in this unit to reach the dimension's canonical unit. */
  toCanonical: number;
  /** Matched at the end of the measurement, longest first. */
  pattern: RegExp;
}

// Longer spellings first so "nautical miles" wins over "m" and "km/h" wins over "km".
// `(?![\p{L}\p{N}])` is a Unicode-aware word end. ASCII `\b` does not treat Cyrillic as a letter.
const UNITS: UnitDef[] = [
  { token: "nmi", dimension: "distance", toCanonical: NM_KM, pattern: /nautical\s+miles?/iu },
  { token: "nmi", dimension: "distance", toCanonical: NM_KM, pattern: /(?:nm|nmi)(?![\p{L}\p{N}])/iu },
  { token: "km/h", dimension: "speed", toCanonical: 1, pattern: /(?:km\/h|kmh|км\/ч|км\/год)/iu },
  { token: "mph", dimension: "speed", toCanonical: MILE_KM, pattern: /mph(?![\p{L}\p{N}])/iu },
  { token: "m/s", dimension: "speed", toCanonical: 3.6, pattern: /(?:m\/s|м\/с)/iu },
  { token: "kn", dimension: "speed", toCanonical: NM_KM, pattern: /(?:knots?|kts|уз(?:л(?:ов|а)?)?)(?![\p{L}\p{N}])/iu },
  { token: "mi", dimension: "distance", toCanonical: MILE_KM, pattern: /miles?(?![\p{L}\p{N}])/iu },
  { token: "mi", dimension: "distance", toCanonical: MILE_KM, pattern: /(?<![\p{L}])mi(?![\p{L}\p{N}])/iu },
  { token: "km", dimension: "distance", toCanonical: 1, pattern: /(?:km|км)(?![\p{L}\p{N}])/iu },
  { token: "m", dimension: "distance", toCanonical: 0.001, pattern: /(?:meters?|metres?|метр(?:ы|ов|а)?)(?![\p{L}\p{N}])/iu },
  { token: "m", dimension: "distance", toCanonical: 0.001, pattern: /(?<![/\p{L}])(?:m|м)(?![\p{L}\p{N}])/iu },
  { token: "lb", dimension: "mass", toCanonical: LB_KG, pattern: /(?:lbs?|pounds?|фунт(?:ов|а)?)(?![\p{L}\p{N}])/iu },
  { token: "oz", dimension: "mass", toCanonical: OZ_KG, pattern: /(?:oz|ounces?)(?![\p{L}\p{N}])/iu },
  { token: "kg", dimension: "mass", toCanonical: 1, pattern: /(?:kg|кг)(?![\p{L}\p{N}])/iu },
  { token: "g", dimension: "mass", toCanonical: 0.001, pattern: /(?:grams?|гр)(?![\p{L}\p{N}])/iu },
  { token: "g", dimension: "mass", toCanonical: 0.001, pattern: /(?<![/\p{L}])(?:g|г)(?![\p{L}\p{N}])/iu },
  { token: "h", dimension: "duration", toCanonical: 60, pattern: /(?:hours?|hrs?|час(?:ов|а)?)(?![\p{L}\p{N}])/iu },
  { token: "h", dimension: "duration", toCanonical: 60, pattern: /(?<![/\p{L}])h(?![\p{L}\p{N}])/iu },
  { token: "min", dimension: "duration", toCanonical: 1, pattern: /(?:minutes?|mins?|мин)(?![\p{L}\p{N}])/iu },
  { token: "s", dimension: "duration", toCanonical: 1 / 60, pattern: /(?:seconds?|secs?|сек)(?![\p{L}\p{N}])/iu },
  { token: "s", dimension: "duration", toCanonical: 1 / 60, pattern: /(?<![/\p{L}])s(?![\p{L}\p{N}])/iu },
];

function findUnit(text: string): { def: UnitDef; index: number } | undefined {
  let best: { def: UnitDef; index: number } | undefined;
  for (const def of UNITS) {
    const flags = def.pattern.flags.includes("g") ? def.pattern.flags : `${def.pattern.flags}g`;
    const re = new RegExp(def.pattern.source, flags);
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      const end = index + m[0].length;
      if (end !== text.trimEnd().length && !/^\s*$/.test(text.slice(end))) continue;
      // Among matches that consume the suffix, the earliest start is the longest unit ("nautical miles" over "miles").
      if (!best || index < best.index) best = { def, index };
    }
  }
  return best;
}

export function convert(value: number, from: string, to: string): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const src = UNITS.find((u) => u.token === from || u.pattern.test(from));
  const dst = UNITS.find((u) => u.token === to || u.pattern.test(to));
  if (!src || !dst || src.dimension !== dst.dimension) return undefined;
  return (value * src.toCanonical) / dst.toCanonical;
}

export function canonicalUnitFor(rawUnit: string): string | undefined {
  const hit = UNITS.find((u) => u.token === rawUnit || u.pattern.test(rawUnit.trim()));
  return hit ? CANONICAL_UNIT[hit.dimension] : undefined;
}

function scale(n: number, factor: number): number {
  return n * factor;
}

/**
 * Parse a measurement into a canonical unit. Returns undefined when no unit is recognized.
 * A range or an open bound does not invent a point `canonicalValue`.
 */
export function normalizeQuantity(raw: string): NormalizedQuantity | undefined {
  const text = raw
    .trim()
    .replace(THIN_SPACE_RE, " ")
    .replace(/[.,;:)]+$/g, "")
    .trim();
  if (!text) return undefined;
  const found = findUnit(text);
  if (!found) return undefined;
  const numeric = text.slice(0, found.index).trim();
  const range = parseRange(numeric);
  if (!range) return undefined;

  const factor = found.def.toCanonical;
  const canonicalUnit = CANONICAL_UNIT[found.def.dimension];
  const usedMagnitude = /(?:k|thousand|тыс|тис|M|million|млн|млрд|billion|\bbn\b)\s*$/i.test(numeric);
  const point = range.qualifier === "exact" || range.qualifier === "approximate";

  const scaled: QuantityRange = { qualifier: range.qualifier };
  if (range.value !== undefined) scaled.value = scale(range.value, factor);
  if (range.min !== undefined) scaled.min = scale(range.min, factor);
  if (range.max !== undefined) scaled.max = scale(range.max, factor);

  const confidence = usedMagnitude ? 0.6 : range.qualifier === "approximate" ? 0.9 : 1;

  return {
    raw,
    ...(range.value !== undefined ? { value: range.value } : {}),
    unit: found.def.token,
    ...(point && scaled.value !== undefined ? { canonicalValue: scaled.value } : {}),
    canonicalUnit,
    range: scaled,
    confidence,
  };
}

const THIN_SPACE_RE = /[\u00a0\u202f\u2009]/g;
