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

/**
 * Bump when the marker lists or the decision rule change. It is stamped in every sampling manifest
 * (schema 1.1.0) that used language detection, so a frame says which detector produced its strata.
 * 3.0.0: revision 3, two evidence channels (distinctive letters L, marker words W).
 */
export const LANGUAGE_DETECTOR_VERSION = "3.0.0";

/** One entry of a closed marker list: the word, why it is safe, and the check against the other language. */
export interface LanguageMarker {
  readonly word: string;
  readonly reason: string;
  readonly otherLanguage: string;
}

const m = (word: string, reason: string, otherLanguage: string): LanguageMarker => ({
  word,
  reason,
  otherLanguage,
});

/**
 * Channel W, Russian side: high-frequency function words and verb forms that occur in Russian only.
 * None contains a letter of the distinctive set (ыэъё or іїєґ), so W sees text that channel L cannot.
 * Frozen by the D0 revision 3 design review; a change needs a reviewed change and a version bump.
 * Deliberately not listed (homographs or shared): та, но, уже, коли, де, може, по, на, до, за, про,
 * не, и, і, зараз, треба, and every word that has a distinctive letter.
 */
export const RUSSIAN_MARKERS: readonly LanguageMarker[] = [
  m("что", "conjunction 'that'", "uk uses що; что is not Ukrainian"),
  m("его", "pronoun 'his, him'", "uk uses його; его is not Ukrainian"),
  m("как", "'how, as'", "uk uses як; как is not Ukrainian"),
  m("когда", "'when'", "uk uses коли; когда is not Ukrainian"),
  m("только", "'only'", "uk uses тільки; только is not Ukrainian"),
  m("сейчас", "'now'", "uk uses зараз, нині; сейчас is not Ukrainian"),
  m("очень", "'very'", "uk uses дуже; очень is not Ukrainian"),
  m("даже", "'even'", "uk uses навіть; даже is not Ukrainian"),
  m("или", "'or'", "uk uses або, чи; или is not Ukrainian"),
  m("где", "'where'", "uk uses де; где is not Ukrainian"),
  m("она", "pronoun 'she'", "uk uses вона; она is not Ukrainian"),
  m("они", "pronoun 'they'", "uk uses вони; они is not Ukrainian"),
  m("которая", "relative 'which' (f.)", "uk uses яка, котра; которая is not Ukrainian"),
  m("которое", "relative 'which' (n.)", "uk uses яке, котре; которое is not Ukrainian"),
  m("которого", "relative 'which' (gen.)", "uk uses якого, котрого; которого is not Ukrainian"),
  m("сообщил", "'reported' (m.), news verb", "uk uses повідомив; сообщил is not Ukrainian"),
  m("сообщила", "'reported' (f.), news verb", "uk uses повідомила; сообщила is not Ukrainian"),
  m("сообщают", "'they report', news verb", "uk uses повідомляють; сообщают is not Ukrainian"),
  m("заявил", "'stated' (m.), news verb", "uk uses заявив; заявил is not Ukrainian"),
  m("упал", "'fell' (m.)", "uk uses упав, впав; упал is not Ukrainian"),
  m("летел", "'flew' (m.)", "uk uses летів; летел is not Ukrainian"),
  m("составляет", "'amounts to', spec phrasing", "uk uses становить; составляет is not Ukrainian"),
  m("около", "'about, approximately'", "uk uses близько, приблизно; около is not Ukrainian"),
  m("ночью", "'at night'", "uk uses вночі; ночью is not Ukrainian"),
  m("также", "'also'", "uk uses також; также is not Ukrainian"),
  m("после", "'after'", "uk uses після; после is not Ukrainian"),
  m("сегодня", "'today'", "uk uses сьогодні; сегодня is not Ukrainian"),
  m("нет", "'no, there is no'", "uk uses ні, немає; нет is not Ukrainian"),
];

/** Channel W, Ukrainian side: the mirror list. No entry contains іїєґ. */
export const UKRAINIAN_MARKERS: readonly LanguageMarker[] = [
  m("що", "conjunction 'that'", "ru uses что; що is not Russian"),
  m("це", "demonstrative 'this, it'", "ru uses это; це is not Russian"),
  m("його", "pronoun 'his, him'", "ru uses его; його is not Russian"),
  m("якщо", "'if'", "ru uses если; якщо is not Russian"),
  m("вже", "'already'", "ru uses уже; вже is not Russian"),
  m("дуже", "'very'", "ru uses очень; дуже is not Russian"),
  m("або", "'or'", "ru uses или; або is not Russian"),
  m("але", "'but'", "ru uses но, а; але is not Russian"),
  m("вона", "pronoun 'she'", "ru uses она; вона is not Russian"),
  m("вони", "pronoun 'they'", "ru uses они; вони is not Russian"),
  m("був", "'was' (m.)", "ru uses был; був is not Russian"),
  m("була", "'was' (f.)", "ru uses была; була is not Russian"),
  m("було", "'was' (n.)", "ru uses было; було is not Russian"),
  m("який", "relative 'which' (m.)", "ru uses который, какой; який is not Russian"),
  m("яка", "relative 'which' (f.)", "ru uses которая, какая; яка is not Russian"),
  m("яке", "relative 'which' (n.)", "ru uses которое, какое; яке is not Russian"),
  m("якого", "relative 'which' (gen.)", "ru uses которого, какого; якого is not Russian"),
  m("заявив", "'stated' (m.), news verb", "ru uses заявил; заявив is not Russian"),
  m("упав", "'fell' (m.)", "ru uses упал; упав is not Russian"),
  m("близько", "'about, approximately'", "ru uses около, примерно; близько is not Russian"),
  m("також", "'also'", "ru uses также; також is not Russian"),
  m("мають", "'have' (3rd pl.)", "ru uses имеют; мають is not Russian"),
  m("можна", "'it is possible'", "ru uses можно; можна is not Russian"),
  m("ще", "'still, yet'", "ru uses ещё, всё ещё; ще is not Russian"),
  m("теж", "'also, too'", "ru uses тоже; теж is not Russian"),
  m("чому", "'why'", "ru uses почему; чому is not Russian"),
];

const RUSSIAN_MARKER_SET: ReadonlySet<string> = new Set(RUSSIAN_MARKERS.map((x) => x.word));
const UKRAINIAN_MARKER_SET: ReadonlySet<string> = new Set(UKRAINIAN_MARKERS.map((x) => x.word));

/**
 * Plan rule 6. A: at least two distinct evidence words in total. B: at least two, and at least one
 * from each channel (L and W). Chosen on the development sets only (see the plan); `DEFAULT_VARIANT`
 * is what production uses.
 */
export type LanguageDetectorVariant = "A" | "B";

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/**
 * Why a detection came out as it did. A closed set, so a caller can branch on it and a log line can
 * be counted. Only `latin_english`, `cyrillic_uk_letters` and `cyrillic_ru_letters` are decisive.
 *
 * - `too_short`: fewer than 12 letters, or a Latin text with fewer than 6 words
 * - `mixed_scripts`: enough letters, but neither script dominates
 * - `latin_english`: Latin text carried by English function words (decisive `en`)
 * - `latin_not_english`: Latin text that is not English (accents, few function words): `unknown`
 * - `cyrillic_uk_letters`: decisive `uk`. Since detector 3.0.0 the name means "Ukrainian evidence":
 *   enough distinct Ukrainian evidence words (ordinary words with іїєґ, channel L, and marker
 *   words, channel W) and none for Russian. The old name is kept because frames store it.
 * - `cyrillic_ru_letters`: the mirror case (decisive `ru`)
 * - `conflicting_evidence`: not decisive, Ukrainian and Russian evidence words both occur and the
 *   conflict is not in channel L alone
 * - `cyrillic_mixed`: not decisive, and either channel L alone has evidence words for both
 *   languages, or the whole text has both letter sets (one set only in names or quotations)
 * - `cyrillic_undetermined`: not decisive, no conflict, too little evidence (none, one word, or one
 *   channel missing under variant B). The language is then the old rule's answer on the whole
 *   text (2 or more Ukrainian-only letters: `uk`, else `ru`), kept for translation routing
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
  "conflicting_evidence",
] as const;
export type LanguageDetectionReason = (typeof LANGUAGE_DETECTION_REASONS)[number];

export type LanguageEvidenceChannel = "L" | "W";

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
  /** Tokens that are Ukrainian evidence (both channels; a token counts once). */
  readonly ukrainianEvidenceOccurrences: number;
  /** Distinct normalised Ukrainian evidence words (the number the decision rule uses). */
  readonly ukrainianEvidenceDistinct: number;
  /** Channels that contributed Ukrainian evidence. */
  readonly ukrainianChannels: readonly LanguageEvidenceChannel[];
  readonly russianEvidenceOccurrences: number;
  readonly russianEvidenceDistinct: number;
  readonly russianChannels: readonly LanguageEvidenceChannel[];
}

interface Side {
  readonly words: Set<string>;
  readonly l: Set<string>;
  readonly w: Set<string>;
  occurrences: number;
}
const newSide = (): Side => ({ words: new Set(), l: new Set(), w: new Set(), occurrences: 0 });

/**
 * One pass over the text. A name says nothing about the language of the sentence around it
 * ("Київ подвергся атаке", "Укрінформ: ..."), so a token is not ordinary when it is: an all-caps
 * word, a capitalised word, the first word of the text or of a sentence (after . ! ? : or a line
 * break), or anything inside «…», „…“ or "…". Ordinary tokens with a distinctive letter are channel
 * L evidence. Marker words (channel W) are matched case-insensitively and whole, are excluded
 * inside quotations and when capitalised or all-caps in mid-sentence, but DO count when
 * sentence-initial: a function word is not a name.
 */
function scanText(sample: string): { names: { uk: number; ru: number }; uk: Side; ru: Side } {
  const token = /[«»„“”"]|[.!?:]+|\n|[\p{L}'’ʼ]+/gu;
  const names = { uk: 0, ru: 0 };
  const uk = newSide();
  const ru = newSide();
  let quoted = false;
  let initial = true;
  const add = (side: Side, channel: "l" | "w", word: string) => {
    side.words.add(word);
    side[channel].add(word);
    side.occurrences++;
  };
  for (const [t] of sample.matchAll(token)) {
    if (t === "«" || t === "„") quoted = true;
    else if (t === "»" || t === "”") quoted = false;
    else if (t === "“" || t === '"') quoted = !quoted;
    else if (t === "\n" || /^[.!?:]/.test(t)) initial = true;
    else {
      const first = t[0]!;
      const upper = first !== first.toLowerCase();
      const allCaps = t.length >= 2 && t === t.toUpperCase() && t !== t.toLowerCase();
      const word = t.toLowerCase().replace(/[’ʼ]/g, "'");
      const ordinary = !(quoted || allCaps || upper || initial);
      const ukLetters = count(t, UKRAINIAN_ONLY);
      const ruLetters = count(t, RUSSIAN_ONLY);
      if (!ordinary) {
        names.uk += ukLetters;
        names.ru += ruLetters;
      } else {
        if (ukLetters > 0) add(uk, "l", word);
        if (ruLetters > 0) add(ru, "l", word);
      }
      // Channel W: quoted text never counts; a capitalised or all-caps word counts only at the
      // start of a sentence.
      if (!quoted && (initial || !(upper || allCaps))) {
        if (UKRAINIAN_MARKER_SET.has(word)) add(uk, "w", word);
        if (RUSSIAN_MARKER_SET.has(word)) add(ru, "w", word);
      }
      initial = false;
    }
  }
  return { names, uk, ru };
}

const channelsOf = (s: Side): LanguageEvidenceChannel[] => [
  ...(s.l.size > 0 ? (["L"] as const) : []),
  ...(s.w.size > 0 ? (["W"] as const) : []),
];

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

/** Variant chosen on the development sets (plan rule 6). */
const DEFAULT_VARIANT: LanguageDetectorVariant = "B";

/**
 * Decisive needs at least two distinct evidence words for one language and none for the other.
 * Variant B also needs support from both channels.
 */
function sufficient(side: Side, variant: LanguageDetectorVariant): boolean {
  if (side.words.size < 2) return false;
  return variant === "A" || (side.l.size > 0 && side.w.size > 0);
}

function detect(text: string, variant: LanguageDetectorVariant): LanguageDetection {
  const sample = text.slice(0, 4000);
  const cyrillic = count(sample, CYRILLIC);
  const latin = count(sample, LATIN);
  const ukrainianOnly = count(sample, UKRAINIAN_ONLY);
  const russianOnly = count(sample, RUSSIAN_ONLY);
  const { names, uk, ru } = scanText(sample);
  const evidence: LanguageEvidence = {
    cyrillic,
    latin,
    ukrainianOnly,
    russianOnly,
    ukrainianOnlyInNames: names.uk,
    russianOnlyInNames: names.ru,
    ukrainianEvidenceOccurrences: uk.occurrences,
    ukrainianEvidenceDistinct: uk.words.size,
    ukrainianChannels: channelsOf(uk),
    russianEvidenceOccurrences: ru.occurrences,
    russianEvidenceDistinct: ru.words.size,
    russianChannels: channelsOf(ru),
  };
  const result = (
    language: DetectedLanguage,
    decisive: boolean,
    reason: LanguageDetectionReason,
  ): LanguageDetection => ({ language, decisive, reason, evidence });

  const letters = cyrillic + latin;
  if (letters < 12) return result("unknown", false, "too_short");

  if (cyrillic / letters > 0.4) {
    if (uk.words.size === 0 && sufficient(ru, variant))
      return result("ru", true, "cyrillic_ru_letters");
    if (ru.words.size === 0 && sufficient(uk, variant))
      return result("uk", true, "cyrillic_uk_letters");
    // Not decisive: the old count rule on the whole text, so routing is as before D0.
    const old: DetectedLanguage = ukrainianOnly >= 2 ? "uk" : "ru";
    if (uk.words.size > 0 && ru.words.size > 0) {
      const onlyL = uk.l.size > 0 && ru.l.size > 0;
      return result(old, false, onlyL ? "cyrillic_mixed" : "conflicting_evidence");
    }
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

/** The one place the rule lives; `detectLanguage` is a wrapper. Uses the production variant. */
export function detectLanguageWithEvidence(text: string): LanguageDetection {
  return detect(text, DEFAULT_VARIANT);
}

/**
 * Development comparison only (plan rule 6): the same rule under variant A or B. Production code
 * must call `detectLanguageWithEvidence`.
 */
export function detectLanguageWithVariant(
  text: string,
  variant: LanguageDetectorVariant,
): LanguageDetection {
  return detect(text, variant);
}

export function detectLanguage(text: string): DetectedLanguage {
  return detectLanguageWithEvidence(text).language;
}
