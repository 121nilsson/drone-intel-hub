import {
  NUM_STRICT,
  SYMBOL_ALT,
  parseMoney,
  parseMoneyRange,
  type ExtraScales,
  type Money,
  type MoneyRange,
} from "@/entities/normalization/currency";
import { alt, compoundAlt, currencyAlt, magnitudeAlt } from "@/shared/lexicons";

/**
 * Money extraction, driven by the lexicons. Magnitudes are flattened longest-first across all
 * languages: left to chance, a single-letter suffix eats the first letter of another language's
 * word - "$2 miljard" would read as 2 million - the same silent drop that once put "$2" on a
 * dossier for a "$2 billion" arms deal.
 */
const CUR = SYMBOL_ALT;
const STATIC_MAG = magnitudeAlt();
const CUR_WORD = currencyAlt();
const COMPOUND = compoundAlt();
const END = "(?![\\p{L}])";

/**
 * `extra` = dynamic unit-scale words (RuleSnapshot.scales). They join the same longest-first
 * magnitude alternation, so "$2 лярда" is read whole once a rule names "лярда".
 */
export function extractPrice(raw: string, extra: ExtraScales = []): string | undefined {
  const MAG = extra.length ? magnitudeAlt(extra.map((x) => x.pattern)) : STATIC_MAG;
  raw = raw.replace(/[\p{Zs}]/gu, " ");
  const AMT = `(\\d[\\d,. ]*\\d|\\d)\\s*(${MAG})?`;
  const re = new RegExp(
    `(${CUR})\\s?${AMT}${END}(?:\\s*(?:-|–|—|to)\\s*(?:${CUR})?\\s?${AMT}${END})?`,
    "u",
  );
  const m = raw.match(re);
  // Symbol after the amount ("1 900 000 ₽", "1,5 млн ₽", "50-60 $"). Whichever form starts first
  // wins, so a trailing symbol is not paired with the number that follows it.
  const AMT_S = `(${NUM_STRICT})\\s*(?:(${MAG})\\.?)?`;
  const sm = raw.match(
    new RegExp(`${AMT_S}(?:\\s*(?:-|–|—|to)\\s*${AMT_S})?\\s*(?:(${CUR})(?![\\p{L}\\d]))?`, "u"),
  );
  if (sm && sm[5] && (!m || sm.index! < m.index!)) {
    const mag = sm[2] ?? sm[4];
    const sym = sm[5];
    const part = (n: string) => `${n}${mag ? ` ${mag}` : ""} ${sym}`;
    return sm[3] ? `${part(sm[1]!)} - ${part(sm[3]!)}` : part(sm[1]!);
  }
  if (m) {
    const fmt = (a: string, s?: string) =>
      `${m[1]}${a.trim()}${s ? (s.length > 2 ? ` ${s}` : s) : ""}`;
    return m[4] ? `${fmt(m[2]!, m[3])} - ${fmt(m[4], m[5])}` : fmt(m[2]!, m[3]);
  }
  // Compounds first: "50 mkr" must not read as magnitude "m" + currency "kr".
  const c = raw.match(new RegExp(`(\\d[\\d,. ]*\\d|\\d)\\s*(${COMPOUND})${END}`, "iu"));
  if (c) return `${c[1]} ${c[2]!.toUpperCase()}`;
  const w = raw.match(
    new RegExp(`(\\d[\\d,. ]*\\d|\\d)\\s*(${MAG})?\\s*(${CUR_WORD})${END}`, "iu"),
  );
  if (w) return `${w[1]}${w[2] ? ` ${w[2]}` : ""} ${w[3]!.toUpperCase()}`;

  return undefined;
}

/** The figure extractPrice found, as a number in its written currency (range kept as a range). */
export function extractPriceNumeric(
  raw: string,
  extra: ExtraScales = [],
): Money | MoneyRange | undefined {
  const text = extractPrice(raw, extra);
  if (!text) return undefined;
  return parseMoney(text, extra) ?? parseMoneyRange(text, extra);
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

export function extractUnitPrice(
  raw: string,
  extra: ExtraScales = [],
): { value: string; evidence: string } | undefined {
  for (const clause of raw.split(/(?<=[.!?;\n])\s+/)) {
    const value = extractPrice(clause, extra);
    if (!value) continue;
    if (!PRICE_CUE.test(clause) || TOTAL_CUE.test(clause)) continue;
    return { value, evidence: clause.trim().slice(0, 300) };
  }
  return undefined;
}

/** A contract-scale figure (deal, contract, budget). Kept apart from unit cost on purpose. */
export function extractContractValue(
  raw: string,
  extra: ExtraScales = [],
): { value: string; evidence: string } | undefined {
  for (const clause of raw.split(/(?<=[.!?;\n])\s+/)) {
    const value = extractPrice(clause, extra);
    if (value && TOTAL_CUE.test(clause)) return { value, evidence: clause.trim().slice(0, 300) };
  }
  return undefined;
}
