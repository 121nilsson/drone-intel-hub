/**
 * Which language a post or summary is written in, as far as the app has to know: English (leave it
 * alone), Russian or Ukrainian (the sources this catalogue reads), or something else.
 *
 * Deliberately small. It is used to decide whether to translate at all and, for a translation model
 * that wants the language pair named, which pair. A wrong "unknown" costs a generic translation
 * request; a wrong "en" would skip a translation, so English needs real evidence.
 */
export type DetectedLanguage = "en" | "ru" | "uk" | "unknown";

/** Letters only the Ukrainian alphabet has. Russian text almost never contains them. */
const UKRAINIAN_ONLY = /[іїєґІЇЄҐ]/g;
/** Letters only the Russian alphabet has. Ukrainian text never contains them. */
const RUSSIAN_ONLY = /[ыэъёЫЭЪЁ]/g;
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

/**
 * Why a detection came out as it did. A closed set, so a caller can branch on it and a log line can
 * be counted. Only `latin_english`, `cyrillic_uk_letters` and `cyrillic_ru_letters` are decisive.
 *
 * - `too_short`: fewer than 12 letters, or a Latin text with fewer than 6 words
 * - `mixed_scripts`: enough letters, but neither script dominates
 * - `latin_english`: Latin text carried by English function words (decisive `en`)
 * - `latin_not_english`: Latin text that is not English (accents, few function words): `unknown`
 * - `cyrillic_uk_letters`: ordinary words (not names, not sentence-initial, not quoted) have Ukrainian-only letters and
 *   no Russian-only letter (decisive `uk`)
 * - `cyrillic_ru_letters`: the mirror case (decisive `ru`)
 * - `cyrillic_mixed`: not decisive, and the whole text has both letter sets (ordinary words with
 *   both, or one set in ordinary words and the other only in names or quotations)
 * - `cyrillic_undetermined`: not decisive, and at most one letter set occurs anywhere, so only a
 *   name or a quotation (or nothing) carries it. The language is then the old rule's answer on the
 *   whole text (2 or more Ukrainian-only letters: `uk`, else `ru`), kept for translation routing
 */
export const LANGUAGE_DETECTION_REASONS = [
  "too_short",
  "mixed_scripts",
  "latin_english",
  "latin_not_english",
  "cyrillic_uk_letters",
  "cyrillic_ru_letters",
  "cyrillic_mixed",
  "cyrillic_undetermined",
] as const;
export type LanguageDetectionReason = (typeof LANGUAGE_DETECTION_REASONS)[number];

/** The counts a detection was based on. Never the text itself, so it is safe to log. */
export interface LanguageEvidence {
  readonly cyrillic: number;
  readonly latin: number;
  /** Ukrainian-only letters (іїєґ) */
  readonly ukrainianOnly: number;
  /** Russian-only letters (ыэъё) */
  readonly russianOnly: number;
  /** Of `ukrainianOnly`, those not in an ordinary word (name, sentence-initial, quotation). */
  readonly ukrainianOnlyInNames: number;
  /** Of `russianOnly`, those not in an ordinary word. */
  readonly russianOnlyInNames: number;
}

/**
 * Letters that sit where a name or a quotation may be, counted apart. A name says nothing about the
 * language of the sentence around it ("Київ подвергся атаке", "Укрінформ: ..."), so a letter is not
 * evidence when it is in: an all-caps word, a capitalised word, the first word of the text or of a
 * sentence (after . ! ? : or a line break), or anything inside «…», „…“ or "…". What remains are
 * ordinary words: lower-case, not sentence-initial, not quoted.
 */
function lettersInNames(sample: string): { uk: number; ru: number } {
  const token = /[«»„“”"]|[.!?:]+|\n|[\p{L}'’ʼ]+/gu;
  let uk = 0;
  let ru = 0;
  let quoted = false;
  let initial = true;
  for (const [t] of sample.matchAll(token)) {
    if (t === "«" || t === "„") quoted = true;
    else if (t === "»" || t === "”") quoted = false;
    else if (t === "“" || t === '"') quoted = !quoted;
    else if (t === "\n" || /^[.!?:]/.test(t)) initial = true;
    else {
      const first = t[0]!;
      const upper = first !== first.toLowerCase();
      const allCaps = t.length >= 2 && t === t.toUpperCase() && t !== t.toLowerCase();
      if (quoted || allCaps || upper || initial) {
        uk += count(t, UKRAINIAN_ONLY);
        ru += count(t, RUSSIAN_ONLY);
      }
      initial = false;
    }
  }
  return { uk, ru };
}

export interface LanguageDetection {
  readonly language: DetectedLanguage;
  /**
   * True when the evidence settles the language. A non-decisive `ru` is a fallback, not a finding:
   * a consumer that treats language as a fact (the resolver, a stratum) must ignore it.
   * `unknown` is never decisive.
   */
  readonly decisive: boolean;
  readonly reason: LanguageDetectionReason;
  readonly evidence: LanguageEvidence;
}

/** The one place the rule lives; `detectLanguage` is a wrapper. */
export function detectLanguageWithEvidence(text: string): LanguageDetection {
  const sample = text.slice(0, 4000);
  const cyrillic = count(sample, CYRILLIC);
  const latin = count(sample, LATIN);
  const ukrainianOnly = count(sample, UKRAINIAN_ONLY);
  const russianOnly = count(sample, RUSSIAN_ONLY);
  const names = lettersInNames(sample);
  const evidence: LanguageEvidence = {
    cyrillic,
    latin,
    ukrainianOnly,
    russianOnly,
    ukrainianOnlyInNames: names.uk,
    russianOnlyInNames: names.ru,
  };
  const result = (
    language: DetectedLanguage,
    decisive: boolean,
    reason: LanguageDetectionReason,
  ): LanguageDetection => ({ language, decisive, reason, evidence });

  const letters = cyrillic + latin;
  if (letters < 12) return result("unknown", false, "too_short");

  if (cyrillic / letters > 0.4) {
    // Only ordinary words settle it; a name or a quotation never does.
    const ukOrdinary = ukrainianOnly - names.uk;
    const ruOrdinary = russianOnly - names.ru;
    if (ukOrdinary >= 1 && ruOrdinary === 0) return result("uk", true, "cyrillic_uk_letters");
    if (ruOrdinary >= 1 && ukOrdinary === 0) return result("ru", true, "cyrillic_ru_letters");
    // Not decisive: the old count rule on the whole text, so routing is as before D0.
    const old: DetectedLanguage = ukrainianOnly >= 2 ? "uk" : "ru";
    const both = ukrainianOnly >= 1 && russianOnly >= 1;
    return result(old, false, both ? "cyrillic_mixed" : "cyrillic_undetermined");
  }

  if (latin / letters > 0.8) {
    const words = sample.toLowerCase().match(/[a-z']+/g) ?? [];
    if (words.length < 6) return result("unknown", false, "too_short");
    const share = words.filter((w) => ENGLISH_WORDS.has(w)).length / words.length;
    const marked = count(sample, NON_ENGLISH_LATIN) / Math.max(latin, 1);
    // English function words carry the sentence; accents on more than a name or two say it is not.
    if (share >= 0.18 && marked < 0.02) return result("en", true, "latin_english");
    return result("unknown", false, "latin_not_english");
  }
  return result("unknown", false, "mixed_scripts");
}

export function detectLanguage(text: string): DetectedLanguage {
  return detectLanguageWithEvidence(text).language;
}
