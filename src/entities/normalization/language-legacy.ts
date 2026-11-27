/**
 * The language rule the app used before D0 (commit 7aea9a6), kept verbatim as the rule for every
 * production decision until a D0 detector version passes its independent evaluation.
 *
 * Decision 2026-11-27: detector 3.1.0 is not approved for production use of decisive language
 * decisions, and no detector version may influence production behaviour before it is approved.
 * Translation routing (`riva.pairFor`) and the "already English" checks therefore use this rule,
 * not `language.ts`. Only the function name differs from the original; its body is unchanged.
 */
import type { DetectedLanguage } from "./language";

/** Letters only the Ukrainian alphabet has. Russian text almost never contains them. */
const UKRAINIAN_ONLY = /[іїєґІЇЄҐ]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[A-Za-z]/g;
/** Latin letters with marks English does not use: a sign the text is Polish, German, French... */
const NON_ENGLISH_LATIN = /[ąćęłńóśźżäöüßéèêàâçñãõíúìòùőűăşţ]/gi;

/** Function words that make up a large share of any English text. */
const ENGLISH_WORDS = new Set(
  (
    "the of and to in a is that for it as with was on by are be this from at or have has were been " +
    "an not which their its but they will can more than also after over into said says during " +
    "while against between about other these those both who what when where how all any each"
  ).split(" "),
);

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

export function detectLanguagePreD0(text: string): DetectedLanguage {
  const sample = text.slice(0, 4000);
  const cyrillic = count(sample, CYRILLIC);
  const latin = count(sample, LATIN);
  const letters = cyrillic + latin;
  if (letters < 12) return "unknown";

  if (cyrillic / letters > 0.4) {
    // Ukrainian has its own letters; a few of them settle it, a quote of a name does not.
    return count(sample, UKRAINIAN_ONLY) >= 2 ? "uk" : "ru";
  }

  if (latin / letters > 0.8) {
    const words = sample.toLowerCase().match(/[a-z']+/g) ?? [];
    if (words.length < 6) return "unknown";
    const share = words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length;
    const marked = count(sample, NON_ENGLISH_LATIN) / Math.max(latin, 1);
    // English function words carry the sentence; accents on more than a name or two say it is not.
    if (share >= 0.18 && marked < 0.02) return "en";
  }
  return "unknown";
}
