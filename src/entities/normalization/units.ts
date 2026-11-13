import { parseRange, type QuantityRange } from "./numeric";

export const CANONICAL_UNIT = {
  distance: "km",
  speed: "km/h",
  mass: "kg",
  duration: "min",
  power: "W",
  volume: "l",
  force: "N",
  acceleration: "m/s2",
  // A load factor is a ratio, not a mass: "4 g" of load is not 4 grams. Its own token keeps it
  // out of every mass conversion (see LOAD_FACTOR_UNIT).
  load_factor: "g_load",
  count_rate: "units/month",
} as const;

/** 200 × 1.852 is 370.40000000000003 in IEEE754; 12 significant digits strip the arithmetic
 * noise without hiding real precision. */
const cleanFloat = (n: number) => Number(n.toPrecision(12));

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
/** International foot in metres. */
const FOOT_M = 0.3048;
/** International inch in metres. */
const INCH_M = 0.0254;
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

/**
 * "50 units/month", "50 systems per month", "50/month", "12 per week" - an optional noun, a
 * mandatory time denominator. Built from one time alternative so the four count-rate units share
 * one rule. The word boundary keeps "per" and "в" from matching inside a longer word.
 */
function COUNT_RATE_PATTERN(time: string, alone?: string): RegExp {
  // "50 monthly" names its time without a preposition; only where the word itself says it.
  const bare = alone ? `|(?<![\\p{L}])(?:${alone})(?![\\p{L}\\p{N}])` : "";
  return new RegExp(
    `(?:(?:units?|systems?|airframes?|drones?|pcs?\\.?|шт\\.?)\\s*)?` +
      `(?:\\/|(?<![\\p{L}])(?:per|в|на)(?![\\p{L}]))\\s*` +
      `(?:${time})(?![\\p{L}\\p{N}])${bare}`,
    "iu",
  );
}

/** Load factor, read only in the context of an attribute that is one. Never in UNITS. */
const LOAD_FACTOR_UNIT: UnitDef = {
  token: "g_load",
  dimension: "load_factor",
  toCanonical: 1,
  pattern: /(?<![/\p{L}])(?:g[-\s]?(?:load|force)|g['’]?s|g)(?![\p{L}\p{N}])/iu,
};

/** Semantics whose figures are load factors ("maneuver.load_factor_max"). */
const LOAD_FACTOR_CONTEXT = "maneuver.load_factor";

/** Optional reading context. Only `semantic` changes a parse, and only for load factors. */
export interface QuantityContext {
  semantic?: string;
}

function unitsFor(ctx?: QuantityContext): readonly UnitDef[] {
  // The load factor goes first so it wins a tie with mass "g" at the same position.
  return ctx?.semantic?.startsWith(LOAD_FACTOR_CONTEXT) ? [LOAD_FACTOR_UNIT, ...UNITS] : UNITS;
}

/** The token-addressed load factor; any other token goes through the global list. */
function tokenUnit(token: string): UnitDef | undefined {
  return token === LOAD_FACTOR_UNIT.token ? LOAD_FACTOR_UNIT : undefined;
}

/** Display form of a canonical unit: the load factor is shown as "g", everything else as is. */
export function displayUnit(unit: string): string {
  return unit === LOAD_FACTOR_UNIT.token ? "g" : unit;
}

// Longer spellings first so "nautical miles" wins over "m" and "km/h" wins over "km".
// `(?![\p{L}\p{N}])` is a Unicode-aware word end. ASCII `\b` does not treat Cyrillic as a letter.
const UNITS: UnitDef[] = [
  // Count rates first. findUnit prefers the earliest start, and a rate starts at its noun or
  // slash, before the time word the duration units would match ("50/day" is a rate, not "day").
  // The time denominator is mandatory, so a bare "3 d" or "5 min" is still a duration. "hour" is
  // left out on purpose: "km/h" is a speed.
  {
    token: "units/month",
    dimension: "count_rate",
    toCanonical: 1,
    pattern: COUNT_RATE_PATTERN("month|mo\\.?|мес\\p{L}*", "monthly"),
  },
  {
    token: "units/week",
    dimension: "count_rate",
    toCanonical: 365.25 / 12 / 7,
    pattern: COUNT_RATE_PATTERN("week|wk|нед\\p{L}*"),
  },
  {
    token: "units/day",
    dimension: "count_rate",
    toCanonical: 365.25 / 12,
    // Cyrillic day words are listed whole: "в диапазоне" and "на дальности" start with "д" too.
    pattern: COUNT_RATE_PATTERN("day|день|дня|дней|сут\\p{L}*|доб[ауи]"),
  },
  {
    token: "units/year",
    dimension: "count_rate",
    toCanonical: 1 / 12,
    pattern: COUNT_RATE_PATTERN("year|yr|год\\p{L}*"),
  },
  // Thrust. First, so "kN" is force and not knots on a tie; lowercase "kn" stays knots.
  // "кгс" ends in a letter, so the "кг" mass unit never takes it.
  {
    token: "kgf",
    dimension: "force",
    toCanonical: 9.80665,
    pattern: /(?:kgf|kg-force|kilograms?[-\s]force|кгс)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "lbf",
    dimension: "force",
    toCanonical: 4.4482216152605,
    pattern: /(?:lbf|pounds?[-\s]force)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "kN",
    dimension: "force",
    toCanonical: 1000,
    pattern:
      /(?:(?<![\p{L}/])(?:kN|KN|кН)|[Kk]ilonewtons?|кілоньютон[а-яіїєґ]*|килоньютон[а-яё]*)(?![\p{L}\p{N}])/u,
  },
  {
    token: "N",
    dimension: "force",
    toCanonical: 1,
    pattern: /(?:[Nn]ewtons?|ньютон[а-яіїєґё]*|(?<![\p{L}/])N)(?![\p{L}\p{N}])/u,
  },
  // Volume: fuel capacity ("15 л", "150 gallons"). Imperial gallons excluded - different factor.
  {
    token: "gal",
    dimension: "volume",
    toCanonical: 3.785411784,
    pattern: /(?<!imperial\s)(?<![/\p{L}])(?:gallons?|gal)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "l",
    dimension: "volume",
    toCanonical: 1,
    pattern: /(?:lit(?:er|re)s?|літр[а-яіїєґ]*|литр[а-яё]*)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "l",
    dimension: "volume",
    toCanonical: 1,
    pattern: /(?<![/\p{L}])(?:l|л)(?![\p{L}\p{N}])/iu,
  },
  { token: "nmi", dimension: "distance", toCanonical: NM_KM, pattern: /nautical\s+miles?/iu },
  {
    token: "nmi",
    dimension: "distance",
    toCanonical: NM_KM,
    pattern: /(?:nm|nmi)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "km/h",
    dimension: "speed",
    toCanonical: 1,
    pattern: /(?:km\/h|kmh|kph|kilomet(?:er|re)s?\s+(?:per|an)\s+hour|км\/ч|км\/год)/iu,
  },
  {
    token: "mph",
    dimension: "speed",
    toCanonical: MILE_KM,
    pattern: /(?:mph|miles?\s*per\s*hour)(?![\p{L}\p{N}])/iu,
  },
  { token: "m/s", dimension: "speed", toCanonical: 3.6, pattern: /(?:m\/s|м\/с)/iu },
  {
    token: "kn",
    dimension: "speed",
    toCanonical: NM_KM,
    pattern:
      /(?:knots?|kts?|(?<![\p{L}/])kn|вузл[а-яіїєґ]*|вузол|уз(?:л(?:ов|а)?)?)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "Mach",
    dimension: "speed",
    toCanonical: 1225,
    pattern: /(?:mach|мах(?:ів|ов|а)?)(?![\p{L}\p{N}])/iu,
  },
  { token: "mi", dimension: "distance", toCanonical: MILE_KM, pattern: /miles?(?![\p{L}\p{N}])/iu },
  {
    token: "mi",
    dimension: "distance",
    toCanonical: MILE_KM,
    pattern: /(?<![\p{L}])mi(?![\p{L}\p{N}])/iu,
  },
  {
    // Aviation and ordnance write altitude in feet; the catalogue keeps kilometres.
    token: "ft",
    dimension: "distance",
    toCanonical: FOOT_M / 1000,
    pattern: /(?:feet|foot)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "ft",
    dimension: "distance",
    toCanonical: FOOT_M / 1000,
    pattern: /(?<![\p{L}])ft(?![\p{L}\p{N}])/iu,
  },
  {
    token: "km",
    dimension: "distance",
    toCanonical: 1,
    pattern:
      /(?:km|kilometers?|kilometres?|км|кілометр[а-яіїєґ]*|километр[а-яё]*)(?![\p{L}\p{N}])/iu,
  },
  // Calibre and small dimensions. Before "m": "мм" and "см" end in "м", "mm" in "m". The hyphen
  // is the adjectival form - "a 155-mm howitzer", "2.75‑inch rockets" (a non-breaking hyphen).
  {
    token: "mm",
    dimension: "distance",
    toCanonical: 1e-6,
    pattern:
      /(?<![\p{L}/])[-‐‑‒–]?\s*(?:mm|мм|millimet(?:er|re)s?|міліметр[а-яіїєґ]*|миллиметр[а-яё]*)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "cm",
    dimension: "distance",
    toCanonical: 1e-5,
    pattern:
      /(?<![\p{L}/])[-‐‑‒–]?\s*(?:cm|см|centimet(?:er|re)s?|сантиметр[а-яіїєґё]*)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "in",
    dimension: "distance",
    toCanonical: INCH_M / 1000,
    // Not a bare "in": it is a word. The inch mark is the double prime, not a quotation mark.
    pattern: /[-‐‑‒–]?\s*(?:inch(?:es)?|дюйм[а-яіїєґё]*|″)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "m",
    dimension: "distance",
    toCanonical: 0.001,
    pattern: /(?:meters?|metres?|метрів|метри?|метр|метр(?:ы|ов|а)?)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "m",
    dimension: "distance",
    toCanonical: 0.001,
    pattern: /(?<![/\p{L}])(?:m|м)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "lb",
    dimension: "mass",
    toCanonical: LB_KG,
    pattern: /(?:lbs?|pounds?|фунт(?:ов|а)?)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "oz",
    dimension: "mass",
    toCanonical: OZ_KG,
    pattern: /(?:oz|ounces?)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "kW",
    dimension: "power",
    toCanonical: 1000,
    pattern: /(?:kilowatts?|kw|кВт)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "hp",
    dimension: "power",
    toCanonical: 745.699872,
    pattern: /(?:horsepower|hp|bhp|л\.с\.?)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "W",
    dimension: "power",
    toCanonical: 1,
    pattern: /(?<![/\p{L}])(?:w|watts?|вт)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "kg",
    dimension: "mass",
    toCanonical: 1,
    pattern:
      /(?:kg|kilograms?|kilogrammes?|kilos?|кг|кілограм[а-яіїєґ]*|килограмм[а-яё]*)(?![\p{L}\p{N}])/iu,
  },
  {
    // Metric tonnes only: a bare "ton" is ambiguous (short ton is 907 kg), and the catalogue
    // is SI, so an ambiguous word is left unparsed rather than read wrong.
    token: "t",
    dimension: "mass",
    toCanonical: 1000,
    pattern: /(?:metric\s+tons?|tonnes?|тонн[а-яіїєґ]*|т)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "g",
    dimension: "mass",
    toCanonical: 0.001,
    pattern: /(?:grams?|гр)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "g",
    dimension: "mass",
    toCanonical: 0.001,
    pattern: /(?<![/\p{L}])(?:g|г)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "h",
    dimension: "duration",
    toCanonical: 60,
    // Ukrainian "годин(а|и)" only: a bare "год" is Russian for year.
    pattern: /(?:hours?|hrs?|час(?:ов|а)?|годин[а-яіїєґ]*)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "h",
    dimension: "duration",
    toCanonical: 60,
    pattern: /(?<![/\p{L}])h(?![\p{L}\p{N}])/iu,
  },
  {
    token: "min",
    dimension: "duration",
    toCanonical: 1,
    pattern: /(?:minutes?|mins?|минут[а-яё]*|мин|хвилин[а-яіїєґ]*|хв)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "d",
    dimension: "duration",
    toCanonical: 1440,
    pattern:
      /(?:days?|dygn|діб|доб[а-яіїєґ]*|дн(?:ів|я|ю|і|ей)|сут(?:ок|к[а-яё]*))(?![\p{L}\p{N}])/iu,
  },
  {
    token: "wk",
    dimension: "duration",
    toCanonical: 10_080,
    pattern: /(?:weeks?|недел[а-яё]*|тижн[а-яіїєґ]*|тиждень)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "s",
    dimension: "duration",
    toCanonical: 1 / 60,
    pattern: /(?:seconds?|secs?|сек)(?![\p{L}\p{N}])/iu,
  },
  {
    token: "s",
    dimension: "duration",
    toCanonical: 1 / 60,
    pattern: /(?<![/\p{L}])s(?![\p{L}\p{N}])/iu,
  },
];

function findUnit(
  text: string,
  units: readonly UnitDef[] = UNITS,
): { def: UnitDef; index: number } | undefined {
  let best: { def: UnitDef; index: number } | undefined;
  for (const def of units) {
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

/**
 * A unit written *before* its number ("Mach 0.8", "kg 150").
 *
 * The suffix form is the common one, but English aviation writing puts the unit first, and a
 * value that cannot be read is a value that never reaches the consensus - it stays a string and
 * the row shows whatever spelling the source happened to use.
 */
function findLeadingUnit(
  text: string,
  units: readonly UnitDef[] = UNITS,
): { def: UnitDef; rest: string } | undefined {
  for (const def of units) {
    const m = def.pattern.exec(text);
    if (!m || m.index !== 0) continue;
    const rest = text.slice(m[0].length).trim();
    if (!/^[\p{N}]/u.test(rest)) continue;
    return { def, rest };
  }
  return undefined;
}

export function convert(value: number, from: string, to: string): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  // "g_load" matches the mass pattern for "g" too, so its own token is looked up first.
  const src = tokenUnit(from) ?? UNITS.find((u) => u.token === from || u.pattern.test(from));
  const dst = tokenUnit(to) ?? UNITS.find((u) => u.token === to || u.pattern.test(to));
  if (!src || !dst || src.dimension !== dst.dimension) return undefined;
  return cleanFloat((value * src.toCanonical) / dst.toCanonical);
}

export function canonicalUnitFor(rawUnit: string): string | undefined {
  const hit =
    tokenUnit(rawUnit) ?? UNITS.find((u) => u.token === rawUnit || u.pattern.test(rawUnit.trim()));
  return hit ? CANONICAL_UNIT[hit.dimension] : undefined;
}

/** Re-express a normalized quantity in another unit of the same dimension (e.g. km → m for hull length). */
export function rebaseQuantity(q: NormalizedQuantity, toUnit: string): NormalizedQuantity {
  const from = q.canonicalUnit;
  if (!from || from === toUnit) return q;
  const next: NormalizedQuantity = { ...q, canonicalUnit: toUnit };
  if (q.canonicalValue !== undefined) {
    const v = convert(q.canonicalValue, from, toUnit);
    if (v !== undefined) next.canonicalValue = v;
  }
  if (q.range) {
    const r = { ...q.range };
    if (r.min !== undefined) {
      const v = convert(r.min, from, toUnit);
      if (v !== undefined) r.min = v;
    }
    if (r.max !== undefined) {
      const v = convert(r.max, from, toUnit);
      if (v !== undefined) r.max = v;
    }
    if (r.value !== undefined) {
      const v = convert(r.value, from, toUnit);
      if (v !== undefined) r.value = v;
    }
    next.range = r;
  }
  return next;
}

function scale(n: number, factor: number): number {
  return cleanFloat(n * factor);
}

/**
 * Parse a measurement into a canonical unit. Returns undefined when no unit is recognized.
 * A range or an open bound does not invent a point `canonicalValue`.
 */
export function normalizeQuantity(
  raw: string,
  ctx?: QuantityContext,
): NormalizedQuantity | undefined {
  const text = raw
    .trim()
    .replace(THIN_SPACE_RE, " ")
    .replace(/[.,;:)]+$/g, "")
    .trim();
  if (!text) return undefined;
  const units = unitsFor(ctx);
  const found = findUnit(text, units);
  // A unit before its number is read the same way, with the number taken from what follows.
  const leading = found ? undefined : findLeadingUnit(text, units);
  const def = found?.def ?? leading?.def;
  if (!def) return undefined;
  const numeric = (found ? text.slice(0, found.index) : leading!.rest).trim();
  const range = parseRange(numeric);
  if (!range) return undefined;
  const factor = def.toCanonical;
  const canonicalUnit = CANONICAL_UNIT[def.dimension];
  const usedMagnitude = /(?:k|thousand|тыс|тис|M|million|млн|млрд|billion|\bbn\b)\s*$/i.test(
    numeric,
  );
  const point = range.qualifier === "exact" || range.qualifier === "approximate";

  const scaled: QuantityRange = { qualifier: range.qualifier };
  if (range.value !== undefined) scaled.value = scale(range.value, factor);
  if (range.min !== undefined) scaled.min = scale(range.min, factor);
  if (range.max !== undefined) scaled.max = scale(range.max, factor);

  const confidence = usedMagnitude ? 0.6 : range.qualifier === "approximate" ? 0.9 : 1;

  return {
    raw,
    ...(range.value !== undefined ? { value: range.value } : {}),
    unit: def.token,
    ...(point && scaled.value !== undefined ? { canonicalValue: scaled.value } : {}),
    canonicalUnit,
    range: scaled,
    confidence,
  };
}

/**
 * The same measurement, read from the part of the text that carries it.
 *
 * A source often writes the figure twice - "3,000 kg (6,600 lb)", "130 to 140 km (81 to 87
 * miles)" - and the second, parenthesised figure is the same measurement in another unit. The
 * text is read as it stands first; only when that fails is the parenthetical dropped and the
 * rest tried, so the primary figure wins.
 */
export function normalizeQuantityLoose(
  raw: string,
  ctx?: QuantityContext,
): NormalizedQuantity | undefined {
  const direct = normalizeQuantity(raw, ctx);
  if (direct) return direct;
  const text = raw.trim();
  const stripped = text.replace(/\s*\([^()]*\)\s*$/, "").trim();
  if (!stripped || stripped === text) return undefined;
  const q = normalizeQuantity(stripped, ctx);
  return q ? { ...q, raw } : undefined;
}

const THIN_SPACE_RE = /[\u00a0\u202f\u2009]/g;
