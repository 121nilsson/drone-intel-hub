import type { SourceUnitBasis, SpecClaim } from "@/entities/drone/types";
import { parseNumber } from "./numeric";
import { convert, normalizeQuantityLoose } from "./units";

/**
 * The unit a claim's figure was written in, as the source shows it.
 *
 * An attribute's unit is the catalogue's presentation unit (mergeSpecs sets it to the canonical
 * one), so it never says what unit one source wrote "105" in: that would turn "105 lbs" into
 * "105 kg". Only a unit the value text or the quote states counts. An extractor's unit is a claim
 * that the text may confirm, contradict, or leave unchecked; a contradiction chooses no unit.
 */

export interface SourceUnit {
  unit?: string;
  basis: SourceUnitBasis;
  /** Both units, when a live check found the extractor and the text disagreeing. */
  disagreement?: { extractor: string; evidenced: string; basis: "value_text" | "quote" };
}

/** Same digit pattern as value-in-quote.ts, so a figure found here is a figure that check sees. */
const NUMBER = /\d{1,3}(?:[\u0020\u00a0\u202f\u2009,.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/** The figure a value states: the number itself, or the first figure a text value writes. */
function figureOf(value: number | string): number | undefined {
  if (typeof value === "number") return value;
  const digits = value.match(NUMBER)?.[0];
  return digits ? parseNumber(digits) : undefined;
}

/**
 * The unit a text states right beside a figure: "lbs" in "105 lbs", "kg/h" in "105 kg/h", or a
 * two-word unit such as "nautical miles". Only the words next to the figure are read, so a unit
 * further along the sentence is not taken for the figure's.
 */
function unitBeside(figure: string, rest: string): string | undefined {
  // What can sit between a figure and its unit without being the unit: "600+ km", "10-plus",
  // "150 to 200 meters", "50 and 100 kg", "16.3m-long", "20-meter-long".
  const after = rest
    .replace(/^\s*(?:\+|-?plus\b)/iu, "")
    .replace(/^\s*(?:to|and|or|до|і|и|–|—|-)\s*\d[\d.,]*/iu, "")
    .replace(/^-(?=\p{L})/u, " ");
  const words = after.match(/^\s*(\S+)(?:\s+(\S+))?/u);
  if (!words?.[1]) return undefined;
  // A unit that opens a hyphenated compound: the "m" of "m-long", the "meter" of "meter-long".
  const stem = words[1].match(/^\p{L}+/u)?.[0];
  const candidates = [
    words[1],
    words[2] ? `${words[1]} ${words[2]}` : undefined,
    stem && stem !== words[1] ? stem : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const unit = normalizeQuantityLoose(`${figure} ${candidate}`)?.unit;
    if (unit) return unit;
  }
  return undefined;
}

/**
 * The unit the quote gives the figure. A quote can state the same figure twice with different units
 * ("150 km and 150 km/h"), so when the extractor named one of them that one is taken; otherwise the
 * first place that states the figure with a unit.
 */
function unitInQuote(figure: number, quote: string, extractorUnit?: string): string | undefined {
  const found: string[] = [];
  for (const m of quote.matchAll(NUMBER)) {
    const n = parseNumber(m[0]);
    if (n === undefined || !same(n, figure)) continue;
    const unit = unitBeside(m[0], quote.slice((m.index ?? 0) + m[0].length));
    if (unit) found.push(unit);
  }
  return (extractorUnit && found.find((u) => sameUnit(u, extractorUnit))) || found[0];
}

/**
 * The same unit, or one of the same dimension and scale: "kg" and "kilograms" agree, "lb" and
 * "kg" do not. A unit the converter does not know is not confirmed as the same.
 */
function sameUnit(a: string, b: string): boolean {
  if (a === b) return true;
  const factor = convert(1, a, b);
  return factor !== undefined && Math.abs(factor - 1) < 1e-9;
}

interface Stated {
  /** Text that may state the unit itself: the raw wording, a string value, a source reading. */
  texts: readonly string[];
  value: number | string;
  quote?: string | undefined;
  /** The extractor's unit for the figure. Checked against the text; never evidence on its own. */
  extractorUnit?: string | undefined;
}

function resolve(s: Stated): SourceUnit {
  let unit: string | undefined;
  let basis: "value_text" | "quote" | undefined;
  for (const text of s.texts) {
    const found = normalizeQuantityLoose(text)?.unit;
    if (found) {
      unit = found;
      basis = "value_text";
      break;
    }
  }
  if (!unit && s.quote) {
    const figure = figureOf(s.value);
    if (figure !== undefined) unit = unitInQuote(figure, s.quote, s.extractorUnit);
    if (unit) basis = "quote";
  }
  if (unit && basis) {
    if (s.extractorUnit && !sameUnit(unit, s.extractorUnit))
      return {
        basis: "conflict",
        disagreement: { extractor: s.extractorUnit, evidenced: unit, basis },
      };
    return { unit, basis };
  }
  // Nothing in the text confirms or contradicts the extractor. Callers must not scale with it.
  if (s.extractorUnit) return { unit: s.extractorUnit, basis: "extractor_unverified" };
  return { basis: "unknown" };
}

/*
 * `normalized.raw` is deliberately not read as source text. apply.ts and renormalize.ts have built it
 * as "${value} ${unit}" from the extractor's or the attribute's unit, in forms no pattern can tell
 * from a quote ("105 kg", "105 nautical miles"), and a stored claim does not say which it is. A
 * figure whose only unit is there is "unknown" until the value text or the quote says one.
 */

export interface ClaimSourceUnitOptions {
  /**
   * Whether the `spec` argument's unit is the extractor's unit for this one claim. Off by default:
   * an attribute's unit is the canonical one, and reading it as the claim's unit is the bug this
   * module exists to stop.
   */
  extractorUnitIsClaimLevel?: boolean;
}

/**
 * The source unit of a stored claim. A basis already on the claim is respected; a claim saved
 * before the basis existed is read from its own text and quote. The attribute's unit is ignored
 * unless the caller says it is claim-level.
 */
export function claimSourceUnit(
  claim: Pick<
    SpecClaim,
    "value" | "raw" | "evidence" | "normalized" | "sourceUnit" | "sourceUnitBasis"
  >,
  spec?: { unit?: string },
  options: ClaimSourceUnitOptions = {},
): SourceUnit {
  if (claim.sourceUnitBasis)
    return claim.sourceUnit
      ? { unit: claim.sourceUnit, basis: claim.sourceUnitBasis }
      : { basis: claim.sourceUnitBasis };
  const valueText = typeof claim.value === "string" ? claim.value : undefined;
  const texts = [claim.raw, valueText].filter((t): t is string => t !== undefined);
  return resolve({
    texts,
    value: claim.value,
    quote: claim.evidence,
    extractorUnit: claim.sourceUnit ?? (options.extractorUnitIsClaimLevel ? spec?.unit : undefined),
  });
}

/**
 * The source unit at write time, from what the extractor produced: its value, its unit claim and
 * the evidence quote. Stored on the spec and copied onto each claim.
 */
export function sourceUnitFor(input: {
  value: number | string;
  unit?: string | undefined;
  evidence?: string | undefined;
  raw?: string | undefined;
}): SourceUnit {
  const valueText = typeof input.value === "string" ? input.value : undefined;
  const texts = [input.raw, valueText].filter((t): t is string => !!t);
  return resolve({
    texts,
    value: input.value,
    quote: input.evidence,
    extractorUnit: input.unit?.trim() || undefined,
  });
}
