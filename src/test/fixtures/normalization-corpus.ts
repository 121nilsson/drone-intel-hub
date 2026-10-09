import type { QuantityRange } from "@/entities/normalization/numeric";
import type { NormalizedQuantity } from "@/entities/normalization/units";
import type { NormalizedRFLink } from "@/entities/normalization/rf";

/**
 * The "suite of horrors": real-world spec strings we have actually seen in source
 * documents, paired with the exact normalization result the pipeline must produce.
 *
 * This file is DATA, not logic. When a parser regression appears in production,
 * add the offending string here as a new fixture entry — the runner
 * (`src/test/normalization-fixtures.test.ts`) picks it up automatically.
 *
 * Every fixture has an optional `note` explaining *why* the string is hard;
 * keep the note when you edit the expectation, so the next reader knows
 * whether the expectation is settled behavior or a pinned gap.
 */

export interface NumberFixture {
  raw: string;
  expected: number | undefined;
  note?: string;
}

export interface RangeFixture {
  raw: string;
  /** Units must already be stripped before parseRange sees the string. */
  expected: QuantityRange | undefined;
  note?: string;
}

export interface QuantityFixture {
  raw: string;
  /** Partial view of NormalizedQuantity; omitted fields are not asserted. */
  expected?: Partial<NormalizedQuantity> | undefined;
  note?: string;
}

export interface MoneyFixture {
  raw: string;
  expected?: { amount: number; currency: string } | undefined;
  note?: string;
}

export interface RfFixture {
  raw: string;
  /** Partial view of NormalizedRFLink; omitted fields are not asserted. */
  expected: Partial<NormalizedRFLink>;
  note?: string;
}

export interface SemanticFixture {
  key: string;
  label?: string;
  expected: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* parseNumber — decimal commas vs thousands grouping                  */
/* ------------------------------------------------------------------ */

export const NUMBERS: NumberFixture[] = [
  { raw: "1,500", expected: 1500, note: "grouped comma → thousands" },
  { raw: "1,5", expected: 1.5, note: "short comma → decimal" },
  { raw: "0,500", expected: 0.5, note: "leading zero forbids grouping" },
  { raw: "2.5", expected: 2.5 },
  { raw: "1 500", expected: 1500, note: "space grouping" },
  { raw: "1\u00a0500", expected: 1500, note: "nbsp grouping" },
  { raw: "1 234 567", expected: 1_234_567, note: "multi-group spaces" },
  {
    raw: "1.234",
    expected: 1234,
    note: "dot followed by exactly three digits → German-style thousands",
  },
  { raw: "007", expected: 7 },
  { raw: "", expected: undefined },
  { raw: "—", expected: undefined, note: "em-dash placeholder" },
  { raw: "N/A", expected: undefined },
  // Pinned gap: mixed Western grouping ("1,234.56") is rejected outright rather than mis-parsed.
  { raw: "1,234.56", expected: undefined, note: "PINNED GAP: mixed grouping is not parsed" },
];

/* ------------------------------------------------------------------ */
/* parseMagnitude — magnitude suffixes                                 */
/* ------------------------------------------------------------------ */

export const MAGNITUDES: NumberFixture[] = [
  { raw: "25k", expected: 25_000 },
  { raw: "2.5M", expected: 2_500_000 },
  { raw: "1.5 thousand", expected: 1_500 },
  { raw: "500 млн", expected: 500_000_000, note: "Russian million" },
  {
    raw: "2.5m",
    expected: undefined,
    note: "a bare lowercase m is NOT million (it is often meters)",
  },
];

/* ------------------------------------------------------------------ */
/* parseRange — qualifiers, bounds, spans                              */
/* ------------------------------------------------------------------ */

export const RANGES: RangeFixture[] = [
  { raw: "120", expected: { value: 120, qualifier: "exact" } },
  {
    raw: "up to 120",
    expected: { max: 120, qualifier: "up_to" },
    note: "an upper bound must not become a point",
  },
  { raw: "80–120", expected: { min: 80, max: 120, qualifier: "range" }, note: "en dash" },
  { raw: "80—120", expected: { min: 80, max: 120, qualifier: "range" }, note: "em dash" },
  { raw: "80 - 120", expected: { min: 80, max: 120, qualifier: "range" }, note: "spaced hyphen" },
  { raw: "80 to 120", expected: { min: 80, max: 120, qualifier: "range" }, note: "word form" },
  { raw: "5-7", expected: { min: 5, max: 7, qualifier: "range" } },
  { raw: "~80", expected: { value: 80, qualifier: "approximate" } },
  { raw: "≈80", expected: { value: 80, qualifier: "approximate" } },
  { raw: "about 80", expected: { value: 80, qualifier: "approximate" } },
  { raw: "approximately 80", expected: { value: 80, qualifier: "approximate" } },
  {
    raw: "более 100",
    expected: { min: 100, qualifier: "greater_than" },
    note: "Russian 'more than'",
  },
  { raw: "не более 120", expected: { max: 120, qualifier: "up_to" }, note: "Russian 'up to'" },
  { raw: "меньше 50", expected: { max: 50, qualifier: "less_than" }, note: "Russian 'less than'" },
  { raw: "свыше 100", expected: { min: 100, qualifier: "greater_than" }, note: "Russian 'over'" },
  { raw: "at least 50", expected: { min: 50, qualifier: "at_least" } },
  // Pinned gap: "Approx." with a trailing period stops the qualifier match before the number.
  { raw: ". 80", expected: undefined, note: "PINNED GAP: qualifier abbreviation with a period" },
];

/* ------------------------------------------------------------------ */
/* normalizeQuantity — units, conversion, confidence                   */
/* ------------------------------------------------------------------ */

export const QUANTITIES: QuantityFixture[] = [
  // Settled behavior
  {
    raw: "80 miles",
    expected: {
      value: 80,
      unit: "mi",
      canonicalUnit: "km",
      canonicalValue: 128.74752,
      confidence: 1,
    },
  },
  {
    raw: "80\u00a0miles",
    expected: { value: 80, unit: "mi", canonicalValue: 128.74752 },
    note: "nbsp inside the measurement",
  },
  {
    raw: "70 nautical miles",
    expected: { unit: "nmi", canonicalValue: 129.64, confidence: 1 },
    note: "longest unit name must win over 'miles'",
  },
  { raw: "1000 m", expected: { canonicalValue: 1, canonicalUnit: "km" } },
  { raw: "130 км", expected: { canonicalValue: 130 }, note: "Cyrillic km" },
  { raw: "100 mph", expected: { canonicalValue: 160.9344, canonicalUnit: "km/h" } },
  {
    raw: "30 m/s",
    expected: { canonicalValue: 108 },
    note: "m/s must not match the bare 'm' or 's' unit",
  },
  { raw: "90 knots", expected: { canonicalValue: 166.68, canonicalUnit: "km/h" } },
  { raw: "2 hours", expected: { canonicalValue: 120, canonicalUnit: "min" } },
  { raw: "5400 seconds", expected: { canonicalValue: 90, canonicalUnit: "min" } },
  {
    raw: "43min",
    expected: { value: 43, canonicalValue: 43, canonicalUnit: "min" },
    note: "no space between value and unit",
  },
  {
    raw: "2.2 lbs",
    expected: { value: 2.2, unit: "lb", canonicalValue: 0.997903214, canonicalUnit: "kg" },
  },
  { raw: "500 г", expected: { canonicalValue: 0.5, canonicalUnit: "kg" }, note: "Cyrillic grams" },
  { raw: "1,5 kg", expected: { value: 1.5, canonicalValue: 1.5 }, note: "decimal comma" },
  {
    raw: "~12 kg",
    expected: { value: 12, canonicalValue: 12, confidence: 0.9 },
    note: "approximate keeps a point but lowers confidence",
  },
  {
    raw: "up to 958 g",
    expected: {
      unit: "g",
      canonicalUnit: "kg",
      range: { max: 0.958, qualifier: "up_to" },
      confidence: 1,
    },
    note: "bound does not invent a canonicalValue",
  },
  {
    raw: "80–120 km",
    expected: { unit: "km", canonicalUnit: "km", range: { min: 80, max: 120, qualifier: "range" } },
  },
  {
    raw: "40-50 knots",
    expected: { range: { min: 74.08, max: 92.6, qualifier: "range" }, canonicalUnit: "km/h" },
  },
  { raw: "", expected: undefined },
  { raw: "80", expected: undefined, note: "bare number without a unit" },
  { raw: "N/A", expected: undefined },
  { raw: "—", expected: undefined },
  { raw: "5.1 GHz", expected: undefined, note: "frequencies are RF data, not a physical quantity" },

  // Pinned gaps: current behavior is 'unrecognized'. When a parser improvement
  // changes one of these, flip the expectation in the same commit and keep the note.
  {
    raw: "Approx. 2.2 lbs",
    expected: undefined,
    note: "PINNED GAP: 'Approx.' with period defeats the qualifier",
  },
  {
    raw: "0.95 kg (2.11 lbs)",
    expected: undefined,
    note: "PINNED GAP: parenthesized duplicate unit",
  },
  { raw: "2 hours 30 minutes", expected: undefined, note: "PINNED GAP: compound duration" },
  { raw: "10 км 500 м", expected: undefined, note: "PINNED GAP: compound Cyrillic distance" },
  {
    raw: "5400 секунд",
    expected: undefined,
    note: "PINNED GAP: 'сек' does not match the full word 'секунд'",
  },
];

/* ------------------------------------------------------------------ */
/* parseMoney — symbols, ISO codes, suffixes, range guard               */
/* ------------------------------------------------------------------ */

export const MONEY: MoneyFixture[] = [
  { raw: "$19,000", expected: { amount: 19_000, currency: "USD" } },
  {
    raw: "50 000 USD",
    expected: { amount: 50_000, currency: "USD" },
    note: "space-grouped number before ISO code",
  },
  {
    raw: "350 000 UAH",
    expected: { amount: 350_000, currency: "UAH" },
    note: "ISO code after a space-grouped number",
  },
  {
    raw: "UAH 350,000",
    expected: undefined,
    note: "PINNED GAP: currency-first ordering is not parsed",
  },
  { raw: "€1.2 million", expected: { amount: 1_200_000, currency: "EUR" } },
  { raw: "₽4.5 million", expected: { amount: 4_500_000, currency: "RUB" } },
  {
    raw: "about $50,000",
    expected: { amount: 50_000, currency: "USD" },
    note: "prose prefix ignored",
  },
  {
    raw: "$15,000 - $20,000",
    expected: undefined,
    note: "a price range must not collapse to one number",
  },
  { raw: "on request", expected: undefined },
  { raw: "", expected: undefined },
];

/* ------------------------------------------------------------------ */
/* normalizeRF — roles, bands, protocols, fiber                        */
/* ------------------------------------------------------------------ */

export const RF: RfFixture[] = [
  {
    raw: "5.8 GHz analog video",
    expected: {
      role: "video",
      freqMHz: [5800, 5800],
      ieeeBands: ["C"],
      natoBands: ["G"],
      confidence: 0.95,
    },
    note: "frequency determines bands; 'analog video' determines role",
  },
  {
    raw: "900 MHz control link",
    expected: {
      role: "uplink",
      freqMHz: [900, 900],
      ieeeBands: ["UHF"],
      natoBands: ["C"],
      tacticalTag: "Sub-GHz C2",
      confidence: 0.9,
    },
  },
  {
    raw: "Ku-band satellite uplink",
    expected: { role: "uplink", ieeeBands: ["Ku"], confidence: 0.9 },
    note: "no frequency → named band from the letter; no tactical tag without a frequency",
  },
  {
    raw: "GPS L1 + GLONASS",
    expected: { role: "gnss", protocols: ["gps-l1", "glonass"], confidence: 0.95 },
    note: "specific protocol 'gps-l1' suppresses the broader 'gps' id",
  },
  {
    raw: "fiber-optic tether, 10 km spool",
    expected: { role: "tether", isFiberOptic: true, tacticalTag: "Fiber optic", confidence: 0.95 },
    note: "fiber never invents a frequency from the spool length",
  },
];

/* ------------------------------------------------------------------ */
/* parseFrequencies — MHz extraction                                   */
/* ------------------------------------------------------------------ */

export const FREQUENCIES: Array<{ raw: string; expected: Array<[number, number]>; note?: string }> =
  [
    { raw: "2.4 GHz", expected: [[2400, 2400]] },
    { raw: "900 MHz", expected: [[900, 900]] },
    { raw: "5.725–5.850 GHz", expected: [[5725, 5850]] },
    {
      raw: "1.4 GHz – 1.6 GHz",
      expected: [[1400, 1600]],
      note: "unit repeated on both sides of the span",
    },
    {
      raw: "300-400 MHz and 2.4 GHz",
      expected: [
        [300, 400],
        [2400, 2400],
      ],
      note: "multiple spans in one string",
    },
    { raw: "L1/L2 GPS", expected: [], note: "a protocol name contributes no frequency" },
    { raw: "70 cm", expected: [], note: "a wavelength shorthand is not parsed as a frequency" },
  ];

/* ------------------------------------------------------------------ */
/* semanticKeyFor — key/label routing                                  */
/* ------------------------------------------------------------------ */

export const SEMANTICS: SemanticFixture[] = [
  { key: "max_range", expected: "range.max" },
  {
    key: "range",
    label: "Max Range",
    expected: "range.max",
    note: "bare key disambiguated by the label",
  },
  { key: "operational_range", expected: "range.operational" },
  { key: "combat_radius", expected: "range.combat_radius" },
  { key: "fiber_spool", expected: "range.fiber_spool" },
  { key: "speed", label: "Cruise speed", expected: "speed.cruise" },
  { key: "dive_speed", expected: "speed.dive" },
  { key: "service_ceiling", expected: "altitude.service_ceiling" },
  {
    key: "payload",
    label: "Warhead",
    expected: "payload.warhead",
    note: "label overrides the capacity default",
  },
  { key: "unit_cost", expected: "cost.unit" },
  { key: "wingspan", expected: "dimension.wingspan" },
  { key: "beam", label: "Beam", expected: "dimension.width", note: "nautical 'beam' is width" },
  {
    key: "some_unknown_key",
    expected: "some_unknown_key",
    note: "unmapped keys pass through unchanged",
  },
];
