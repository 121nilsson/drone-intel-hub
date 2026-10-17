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
const END = String.raw`(?![\p{L}])`;

/**
 * Magnitude and currency words come from the shared lexicons (@/shared/lexicons), the same
 * vocabulary the heuristic extractor uses - so "50 miljoner kronor", "45,6 млн грн" and
 * "50 mkr" parse without code changes here. Compiled once, on first use.
 */
let patterns: { symbol: RegExp; compound: RegExp; word: RegExp } | undefined;
function re() {
  if (patterns) return patterns;
  const mag = magnitudeAlt();
  return (patterns = {
    symbol: new RegExp(`(C\\$|A\\$|[$€£₽₴₺¥])\\s*(${NUM})(?:\\s*(${mag})\\.?${END})?`, "iu"),
    compound: new RegExp(`(${NUM})\\s*(${compoundAlt()})${END}`, "iu"),
    word: new RegExp(`(${NUM})\\s*(?:(${mag})\\.?\\s*)?(${currencyAlt()})${END}`, "iu"),
  });
}

function amountOf(num: string, magnitude: string | undefined): number | undefined {
  const base = parseNumber(num.trim());
  if (base === undefined) return undefined;
  if (!magnitude) return base;
  // Next to a currency a lowercase "m" is million ("$2.5m"); on its own it would be metres.
  const mult = magnitude === "m" ? 1e6 : scaleOf(magnitude);
  return mult === undefined ? undefined : base * mult;
}

/**
 * Parse a single amount. A range such as "$15,000 - $20,000" returns undefined so it is
 * not collapsed into one number. `$` is USD unless the same text says CAD or AUD.
 */
export function parseMoney(raw: string): Money | undefined {
  const text = raw.trim().replace(/[\u00a0\u202f\u2009]/g, " ");
  if (!text) return undefined;
  if (/\d\s*(?:-|–|—|\bto\b)\s*(?:[$€£₽₴₺¥]|[A-Z]{3})?\s*\d/i.test(text)) return undefined;
  const { symbol, compound, word } = re();

  const s = text.match(symbol);
  if (s) {
    let currency = SYMBOL[s[1]!.toUpperCase()] ?? SYMBOL[s[1]!];
    if (s[1] === "$" && /\bCAD\b|C\$/.test(text)) currency = "CAD";
    if (s[1] === "$" && /\bAUD\b|A\$/.test(text)) currency = "AUD";
    const amount = amountOf(s[2]!, s[3]);
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
  const amount = amountOf(w[1]!, w[2]);
  return currency && amount !== undefined ? { amount, currency, raw } : undefined;
}

/** Parse a closed price range without collapsing it to a misleading point estimate. */
export function parseMoneyRange(raw: string): MoneyRange | undefined {
  const parts = raw.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  if (parts.length !== 2) return undefined;
  const left = parseMoney(parts[0]!);
  const rightRaw = parts[1]!;
  const right =
    parseMoney(rightRaw) ?? parseMoney(left ? `${rightRaw} ${left.currency}` : rightRaw);
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
