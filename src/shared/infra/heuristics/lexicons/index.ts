import { en } from "./en";
import { ru } from "./ru";
import { sv } from "./sv";
import type { Lexicon } from "./types";
import { uk } from "./uk";

export type { Lexicon } from "./types";

/** Every registered language. Add a new lexicon here and every extractor picks it up. */
export const LEXICONS: Lexicon[] = [en, uk, ru, sv];

const byLengthDesc = (a: string, b: string) => b.length - a.length;

/**
 * One alternation across all languages, longest first so a short entry ("m") never eats the
 * start of a longer one ("miljard"). Non-capturing so callers keep their own group numbers.
 */
export function alt(pick: (l: Lexicon) => string[], lexicons: Lexicon[] = LEXICONS): string {
  const all = [...new Set(lexicons.flatMap(pick))].sort(byLengthDesc);
  return `(?:${all.join("|")})`;
}

export const cue = (k: keyof Lexicon["cues"]) => alt((l) => l.cues[k]);
export const unit = (k: keyof Lexicon["units"]) => alt((l) => l.units[k]);
