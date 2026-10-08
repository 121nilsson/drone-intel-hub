import { parseMagnitude, parseNumber } from "./numeric";

export interface Money {
  amount: number;
  /** ISO 4217 code. */
  currency: string;
  raw: string;
  /** Present only when the caller supplied a rate snapshot. */
  usd?: { value: number; rate: number; rateAsOf: string; rateSource: string };
}

const ISO: Record<string, string> = {
  USD: "USD",
  EUR: "EUR",
  GBP: "GBP",
  RUB: "RUB",
  UAH: "UAH",
  TRY: "TRY",
  JPY: "JPY",
  CAD: "CAD",
  AUD: "AUD",
  DOLLAR: "USD",
  DOLLARS: "USD",
  EURO: "EUR",
  EUROS: "EUR",
  RUBLE: "RUB",
  RUBLES: "RUB",
  ROUBLE: "RUB",
  ROUBLES: "RUB",
  HRYVNIA: "UAH",
  HRYVNIAS: "UAH",
};

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

/**
 * Parse a single amount. A range such as "$15,000 - $20,000" returns undefined so it is
 * not collapsed into one number. `$` is USD unless the same text says CAD or AUD.
 */
export function parseMoney(raw: string): Money | undefined {
  const text = raw.trim().replace(/[\u00a0\u202f\u2009]/g, " ");
  if (!text) return undefined;
  if (/\d\s*(?:-|–|—|\bto\b)\s*(?:[$€£₽₴₺¥]|[A-Z]{3})?\s*\d/i.test(text)) return undefined;

  const m = text.match(
    /(?:(C\$|A\$|[$€£₽₴₺¥])\s*([+-]?\d[\d.,\s]*\d|\d)(?:\s*([kKmM]|thousand|million|млн|млрд))?|(?:([+-]?\d[\d.,\s]*\d|\d)\s*([kKmM]|thousand|million|млн|млрд)?\s*(USD|EUR|GBP|RUB|UAH|TRY|JPY|CAD|AUD|dollars?|euros?|rubles?|roubles?|hryvnias?)))/i,
  );
  if (!m) return undefined;

  const suffix = (suf: string | undefined) => {
    if (!suf) return "";
    if (suf === "m" || suf === "M") return "M";
    if (suf === "k" || suf === "K") return "k";
    return ` ${suf}`;
  };
  let currency: string | undefined;
  let amountText: string;
  if (m[1] && m[2]) {
    currency = SYMBOL[m[1]] ?? SYMBOL[m[1].toUpperCase()];
    amountText = `${m[2]}${suffix(m[3])}`;
    if (m[1] === "$" && /\bCAD\b|C\$/.test(text)) currency = "CAD";
    if (m[1] === "$" && /\bAUD\b|A\$/.test(text)) currency = "AUD";
  } else if (m[4] && m[6]) {
    currency = ISO[m[6].toUpperCase()];
    amountText = `${m[4]}${suffix(m[5])}`;
  } else {
    return undefined;
  }
  if (!currency) return undefined;

  const amount = parseMagnitude(amountText.trim()) ?? parseNumber(amountText.trim());
  if (amount === undefined) return undefined;
  return { amount, currency, raw };
}

/** Attach a USD estimate. The original amount and currency are unchanged. */
export function toUSD(m: Money, rate: number, asOf: string, source: string): Money {
  if (!Number.isFinite(rate) || rate <= 0) return m;
  return { ...m, usd: { value: m.amount * rate, rate, rateAsOf: asOf, rateSource: source } };
}
