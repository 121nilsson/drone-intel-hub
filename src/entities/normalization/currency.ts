import {
  compoundAlt,
  compoundOf,
  currencyAlt,
  currencyOf,
  magnitudeAlt,
  scaleOf,
} from "@/shared/lexicons";
import { parseNumber } from "./numeric";

export interface Money {
  amount: number;
  /** ISO 4217 code. */
  currency: string;
  raw: string;
  /** Present only when the caller supplied a rate snapshot. */
  usd?: { value: number; rate: number; rateAsOf: string; rateSource: string };
}

/**
 * Extra magnitude words (dynamic add_unit_scale rules), structurally typed so entities need not
 * know the rule contract. A static lexicon word always wins: a rule can add, never redefine.
 */
export type ExtraScales = ReadonlyArray<{ word: string; pattern: string; multiplier: number }>;

export interface MoneyRange {
  min: number;
  max: number;
  currency: string;
  raw: string;
}

const SYMBOL: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₽": "RUB",
  "₴": "UAH",
  "₺": "TRY",
  "¥": "JPY",
  C$: "CAD",
  A$: "AUD",
};

const NUM = String.raw`[+-]?\d[\d.,\s]*\d|\d`;
/**
 * Currency symbols, longest first; the one list the prefix and suffix parsers and the heuristic
 * price extractor share, so they cannot disagree on what counts as a currency.
 */
export const SYMBOL_ALT = String.raw`C\$|A\$|[$€£₽₴₺¥]`;
/**
 * A number that cannot swallow a neighbouring one: groups are exactly three digits, so the model
 * number in "Matrice 4 1 900 000 ₽" stays out of the amount. Used where the number comes first.
 */
export const NUM_STRICT = String.raw`(?<![\d.,])(?:\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;

/** ISO code for a symbol; "$" is USD unless the same text says CAD or AUD. */
function symbolCurrency(symbol: string, text: string): string | undefined {
  if (symbol === "$") {
    if (/\bCAD\b|C\$/.test(text)) return "CAD";
    if (/\bAUD\b|A\$/.test(text)) return "AUD";
  }
  return SYMBOL[symbol.toUpperCase()] ?? SYMBOL[symbol];
}

const END = String.raw`(?![\p{L}])`;

/**
 * Magnitude and currency words come from the shared lexicons (@/shared/lexicons), the same
 * vocabulary the heuristic extractor uses - so "50 miljoner kronor", "45,6 млн грн" and
 * "50 mkr" parse without code changes here. Compiled once, on first use.
 */
type Patterns = {
  range: RegExp;
  symbol: RegExp;
  symbolSuffix: RegExp;
  compound: RegExp;
  word: RegExp;
};
/** Keyed by the extra words, so each distinct rule set compiles once. */
const patterns = new Map<string, Patterns>();
function re(extra: ExtraScales = []): Patterns {
  const key = extra.map((x) => x.pattern).join("|");
  const hit = patterns.get(key);
  if (hit) return hit;
  const mag = magnitudeAlt(extra.map((x) => x.pattern));
  const built: Patterns = {
    // A figure, optionally followed by a magnitude or currency, then a dash and another figure.
    range: new RegExp(
      `\\d\\s*(?:(?:${mag})\\.?|${SYMBOL_ALT}|[A-Z]{3})?\\s*(?:-|–|—|\\bto\\b)\\s*(?:${SYMBOL_ALT}|[A-Z]{3})?\\s*\\d`,
      "iu",
    ),
    symbol: new RegExp(`(${SYMBOL_ALT})\\s*(${NUM})(?:\\s*(${mag})\\.?${END})?`, "iu"),
    // Symbol after the amount, e.g. "1 900 000 ₽" or "45 тыс. ₽"; common in RU/UA sources.
    symbolSuffix: new RegExp(
      `(${NUM_STRICT})\\s*(?:(${mag})\\.?)?\\s*(${SYMBOL_ALT})(?![\\p{L}\\d])`,
      "iu",
    ),
    compound: new RegExp(`(${NUM})\\s*(${compoundAlt()})${END}`, "iu"),
    word: new RegExp(`(${NUM})\\s*(?:(${mag})\\.?\\s*)?(${currencyAlt()})${END}`, "iu"),
  };
  patterns.set(key, built);
  return built;
}

function amountOf(
  num: string,
  magnitude: string | undefined,
  extra: ExtraScales = [],
): number | undefined {
  const base = parseNumber(num.trim());
  if (base === undefined) return undefined;
  if (!magnitude) return base;
  // Next to a currency a lowercase "m" is million ("$2.5m"); on its own it would be metres.
  const word = magnitude.trim().replace(/\.$/, "").replace(/\s+/g, " ").toLowerCase();
  const mult =
    magnitude === "m"
      ? 1e6
      : (scaleOf(magnitude) ?? extra.find((x) => x.word === word)?.multiplier);
  return mult === undefined ? undefined : base * mult;
}

/**
 * Parse a single amount. A range such as "$15,000 - $20,000" returns undefined so it is
 * not collapsed into one number. `$` is USD unless the same text says CAD or AUD.
 */
export function parseMoney(raw: string, extra: ExtraScales = []): Money | undefined {
  const text = raw.trim().replace(/[\u00a0\u202f\u2009]/g, " ");
  if (!text) return undefined;
  const { range, symbol, symbolSuffix, compound, word } = re(extra);
  if (range.test(text)) return undefined;

  // Whichever form starts first wins: in "1 900 000 ₽ 2 шт" the prefix form would pair the
  // trailing symbol with the "2" that follows it.
  const pre = text.match(symbol);
  const post = text.match(symbolSuffix);
  const hit =
    post && (!pre || post.index! < pre.index!)
      ? { sym: post[3]!, num: post[1]!, mag: post[2] }
      : pre
        ? { sym: pre[1]!, num: pre[2]!, mag: pre[3] }
        : undefined;
  if (hit) {
    const currency = symbolCurrency(hit.sym, text);
    const amount = amountOf(hit.num, hit.mag, extra);
    return currency && amount !== undefined ? { amount, currency, raw } : undefined;
  }

  const c = text.match(compound);
  if (c) {
    const info = compoundOf(c[2]!);
    const base = parseNumber(c[1]!.trim());
    if (info && base !== undefined)
      return { amount: base * info.scale, currency: info.currency, raw };
  }

  const w = text.match(word);
  if (!w) return undefined;
  const currency = currencyOf(w[3]!);
  const amount = amountOf(w[1]!, w[2], extra);
  return currency && amount !== undefined ? { amount, currency, raw } : undefined;
}

/** Parse a closed price range without collapsing it to a misleading point estimate. */
export function parseMoneyRange(raw: string, extra: ExtraScales = []): MoneyRange | undefined {
  const parts = raw.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  if (parts.length !== 2) return undefined;
  const left = parseMoney(parts[0]!, extra);
  const rightRaw = parts[1]!;
  const right =
    parseMoney(rightRaw, extra) ??
    parseMoney(left ? `${rightRaw} ${left.currency}` : rightRaw, extra);
  if (!left || !right || left.currency !== right.currency) return undefined;
  return {
    min: Math.min(left.amount, right.amount),
    max: Math.max(left.amount, right.amount),
    currency: left.currency,
    raw,
  };
}

/** Attach a USD estimate. The original amount and currency are unchanged. */
export function toUSD(m: Money, rate: number, asOf: string, source: string): Money {
  if (!Number.isFinite(rate) || rate <= 0) return m;
  return { ...m, usd: { value: m.amount * rate, rate, rateAsOf: asOf, rateSource: source } };
}
