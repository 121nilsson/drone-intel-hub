import { parseMoney, parseMoneyRange, type Money, type MoneyRange } from "@/entities/normalization/currency";
import { alt, compoundAlt, currencyAlt, magnitudeAlt } from "@/shared/lexicons";

/**
 * Money extraction, driven by the lexicons. Magnitudes are flattened longest-first across all
 * languages: left to chance, a single-letter suffix eats the first letter of another language's
 * word - "$2 miljard" would read as 2 million - the same silent drop that once put "$2" on a
 * dossier for a "$2 billion" arms deal.
 */
const CUR = "[$€£₽₴]";
const MAG = magnitudeAlt();
const CUR_WORD = `(?:${compoundAlt()}|${currencyAlt()})`;
const AMT = `(\\d[\\d,. ]*\\d|\\d)\\s*(${MAG})?`;
const END = "(?![\\p{L}])";

export function extractPrice(raw: string): string | undefined {
  const re = new RegExp(
    `(${CUR})\\s?${AMT}${END}(?:\\s*(?:-|–|—|to)\\s*${CUR}?\\s?${AMT}${END})?`,
    "u",
  );
  const m = raw.match(re);
  if (m) {
    const fmt = (a: string, s?: string) =>
      `${m[1]}${a.trim()}${s ? (s.length > 2 ? ` ${s}` : s) : ""}`;
    return m[4] ? `${fmt(m[2]!, m[3])} - ${fmt(m[4], m[5])}` : fmt(m[2]!, m[3]);
  }
  const w = raw.match(
    new RegExp(`(\\d[\\d,. ]*\\d|\\d)\\s*(${MAG})?\\s*(${CUR_WORD})${END}`, "iu"),
  );
  return w ? `${w[1]}${w[2] ? ` ${w[2]}` : ""} ${w[3]!.toUpperCase()}` : undefined;
}

/**
 * Money in OSINT reporting is far more often programme value than a price tag, so a unit-cost
 * claim needs evidence the figure is per unit, and must not sit in a clause describing a total
 * (contract, deal, budget, aid package - in any registered language). Under-claiming leaves the
 * text for an analyst; over-claiming writes a wrong figure into every consensus that reads it.
 */
const PRICE_CUE = new RegExp(
  alt((l) => l.money.unitPriceCues),
  "iu",
);
const TOTAL_CUE = new RegExp(
  alt((l) => l.money.totalCues),
  "iu",
);

export function extractUnitPrice(raw: string): { value: string; evidence: string } | undefined {
  for (const clause of raw.split(/(?<=[.!?;\n])\s+/)) {
    const value = extractPrice(clause);
    if (!value) continue;
    if (!PRICE_CUE.test(clause) || TOTAL_CUE.test(clause)) continue;
    return { value, evidence: clause.trim().slice(0, 300) };
  }
  return undefined;
}

/** A contract-scale figure (deal, contract, budget). Kept apart from unit cost on purpose. */
export function extractContractValue(raw: string): { value: string; evidence: string } | undefined {
  for (const clause of raw.split(/(?<=[.!?;\n])\s+/)) {
    const value = extractPrice(clause);
    if (value && TOTAL_CUE.test(clause)) return { value, evidence: clause.trim().slice(0, 300) };
  }
  return undefined;
}
