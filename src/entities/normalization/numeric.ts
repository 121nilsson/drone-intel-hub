export type QuantityQualifier =
  | "exact"
  | "approximate"
  | "up_to"
  | "at_least"
  | "less_than"
  | "greater_than"
  | "range";

/** Numeric span in the raw unit. `value` is set only for a point (exact or approximate). */
export interface QuantityRange {
  value?: number;
  min?: number;
  max?: number;
  qualifier: QuantityQualifier;
}

const THIN_SPACE = /[\u00a0\u202f\u2009]/g;

/**
 * Parse a number that may use a decimal comma ("1,5") or thousands grouping ("1,500" / "1 500").
 * Grouping applies only when every group after the first is exactly three digits and the first
 * group has no leading zero, so "0,500" stays 0.5 and "1,500" becomes 1500.
 */
export function parseNumber(s: string): number | undefined {
  const t = s.trim().replace(THIN_SPACE, " ");
  if (!t || !/\d/.test(t)) return undefined;

  const spaced = t.match(/^([1-9]\d{0,2}(?: \d{3})+)(?:([,.])(\d+))?$/);
  if (spaced) {
    const whole = spaced[1]!.replace(/ /g, "");
    if (spaced[2] === undefined) return Number(whole);
    return Number(`${whole}.${spaced[3]}`);
  }

  if (/^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));

  const normalized = t.replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

const MAGNITUDE =
  /^(.*?)\s*(k|K|thousand|тыс\.?|тис\.?|M|million|млн\.?|млрд\.?|billion|bn)$/;

/** "25k" → 25000, "2.5M" → 2_500_000, "500 млн" → 500e6. A bare "m" is not million. */
export function parseMagnitude(s: string): number | undefined {
  const t = s.trim().replace(THIN_SPACE, " ");
  const m = t.match(MAGNITUDE);
  if (!m?.[1] || !m[2]) return parseNumber(t);
  const base = parseNumber(m[1].trim());
  if (base === undefined) return undefined;
  const suf = m[2];
  const mult =
    suf === "M" || /^million$/i.test(suf) || /^млн/i.test(suf)
      ? 1e6
      : /^млрд/i.test(suf) || /^billion$/i.test(suf) || /^bn$/i.test(suf)
        ? 1e9
        : 1e3;
  return base * mult;
}

const QUALIFIER_PREFIX: Array<[RegExp, QuantityQualifier]> = [
  [/^(?:up\s*to|не\s+более)\s+/i, "up_to"],
  [/^(?:at\s+least|не\s+менее)\s+/i, "at_least"],
  [/^(?:less\s+than|under|меньше)\s+/i, "less_than"],
  [/^(?:more\s+than|greater\s+than|over|свыше|более)\s+/i, "greater_than"],
  [/^(?:~|≈|approx(?:imately)?|about|около|примерно)\s*/i, "approximate"],
];

/**
 * Parse a qualifier and one number or a span. Units must already have been removed.
 * "up to 120" stays an upper bound and does not become an exact 120.
 */
export function parseRange(raw: string): QuantityRange | undefined {
  const text = raw.trim().replace(THIN_SPACE, " ");
  if (!text) return undefined;

  let rest = text;
  let qualifier: QuantityQualifier = "exact";
  for (const [re, q] of QUALIFIER_PREFIX) {
    const m = rest.match(re);
    if (m) {
      qualifier = q;
      rest = rest.slice(m[0].length).trim();
      break;
    }
  }
  if (!rest) return undefined;

  const parts = rest.split(/\s*(?:–|—|-|to)\s*/i).filter((p) => p.length > 0);
  if (parts.length === 2) {
    const a = parseMagnitude(parts[0]!) ?? parseNumber(parts[0]!);
    const b = parseMagnitude(parts[1]!) ?? parseNumber(parts[1]!);
    if (a === undefined || b === undefined) return undefined;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return { min, max, qualifier: "range" };
  }
  if (parts.length !== 1) return undefined;

  const n = parseMagnitude(parts[0]!) ?? parseNumber(parts[0]!);
  if (n === undefined) return undefined;
  if (qualifier === "up_to" || qualifier === "less_than") return { max: n, qualifier };
  if (qualifier === "at_least" || qualifier === "greater_than") return { min: n, qualifier };
  if (qualifier === "approximate") return { value: n, qualifier };
  return { value: n, qualifier: "exact" };
}
