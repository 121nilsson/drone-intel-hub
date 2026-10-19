import { en } from "./en";
import { ru } from "./ru";
import { sv } from "./sv";
import type { Lexicon, MoneyScale } from "./types";
import { uk } from "./uk";

export type { Lexicon, MoneyScale } from "./types";

/** Every registered language. Add a new lexicon here and every extractor picks it up. */
export const LEXICONS: Lexicon[] = [en, uk, ru, sv];

const byLengthDesc = (a: string, b: string) => b.length - a.length;

/**
 * One alternation across all languages, longest first so a short entry ("m") never eats the
 * start of a longer one ("miljard"). Non-capturing so callers keep their own group numbers.
 */
export function alt(
  pick: (l: Lexicon) => string[],
  lexicons: Lexicon[] = LEXICONS,
  extra: readonly string[] = [],
): string {
  const all = [...new Set([...lexicons.flatMap(pick), ...extra])].sort(byLengthDesc);
  return `(?:${all.join("|")})`;
}

export const cue = (k: keyof Lexicon["cues"]) => alt((l) => l.cues[k]);
export const unit = (k: keyof Lexicon["units"]) => alt((l) => l.units[k]);

// ---- Money vocabulary, shared by heuristic extraction and normalization ----

export const SCALE: Record<MoneyScale, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };
const SCALES = Object.keys(SCALE) as MoneyScale[];

/**
 * Every magnitude word in every language, plus `extra` fragments (dynamic unit-scale rules),
 * sorted into the same longest-first alternation so a rule's word cannot be eaten by a shorter one.
 */
export const magnitudeAlt = (extra: readonly string[] = []) =>
  alt((l) => SCALES.flatMap((s) => l.money.magnitudes[s]), LEXICONS, extra);
/** Every currency word or code in every language. */
export const currencyAlt = () =>
  alt((l) => Object.values(l.money.currencies).flatMap((v) => v ?? []));
/** Every combined magnitude+currency token ("mkr"). */
export const compoundAlt = () => alt((l) => (l.money.compounds ?? []).map((c) => c.word));

const whole = (frag: string) => new RegExp(`^(?:${frag})$`, "iu");
const cache = new Map<string, RegExp>();
const test = (frag: string, s: string) => {
  let re = cache.get(frag);
  if (!re) cache.set(frag, (re = whole(frag)));
  return re.test(s);
};

/** Multiplier for a magnitude word as written, e.g. "miljarder" → 1e9. */
export function scaleOf(word: string): number | undefined {
  const w = word.trim().replace(/\.$/, "");
  // Case decides the single letters: "M" is million, a bare "m" is metres.
  if (w === "m") return undefined;
  for (const l of LEXICONS)
    for (const s of SCALES) if (l.money.magnitudes[s].some((f) => test(f, w))) return SCALE[s];
  return undefined;
}

/** ISO 4217 code for a currency word as written, e.g. "kronor" → "SEK". */
export function currencyOf(word: string): string | undefined {
  const w = word.trim();
  for (const l of LEXICONS)
    for (const [iso, frags] of Object.entries(l.money.currencies))
      if (frags?.some((f) => test(f, w))) return iso;
  return undefined;
}

/** Scale and currency for a compound token, e.g. "mkr" → million SEK. */
export function compoundOf(word: string): { scale: number; currency: string } | undefined {
  for (const l of LEXICONS)
    for (const c of l.money.compounds ?? [])
      if (test(c.word, word.trim())) return { scale: SCALE[c.scale], currency: c.currency };
  return undefined;
}
