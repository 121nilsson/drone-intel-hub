import { parseMagnitude, parseNumber } from "@/entities/normalization/numeric";

/**
 * Whether a claim's quote states the claim's value. The evidence check proves the quote is in the
 * post and the identity check that its sentence names the system; neither looks at the value. An
 * extractor that quotes the wrong sentence - the system's C2 link as evidence for its description,
 * "200 km further than the Iskander-M" for a 500 km range - passes both, so without this check a
 * claim is "verified" on evidence that does not say what it claims.
 *
 * Pure and one-sided: a match is a pass; a miss is only "not shown". Russian and Ukrainian number
 * words decline ("четырех", "двох"), and a text value is often an English rendering of a quote in
 * another language, so a deterministic miss cannot prove the quote wrong. It leaves the claim
 * uncertain, which is where the second reader looks.
 */

/** A grouped number ("1,200", "3 000") before a plain or decimal one ("7", "1,5"). */
const NUMBER = /\d{1,3}(?:[ \u00a0\u202f\u2009,.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’ʼ]*/gu;

const fold = (s: string) => s.normalize("NFKC").toLowerCase();

/**
 * Each figure a text writes in digits, as every number it can be read as: the figure itself and,
 * when a magnitude word follows, the scaled figure ("100 млн" is 100 and 100,000,000).
 */
function digitFigures(text: string): number[][] {
  const t = fold(text);
  const out: number[][] = [];
  for (const m of t.matchAll(NUMBER)) {
    const n = parseNumber(m[0]);
    if (n === undefined) continue;
    const next = t.slice(m.index + m[0].length).match(/^\s*(\p{L}+\.?)/u)?.[1];
    const scaled = next ? parseMagnitude(`${m[0]} ${next}`) : undefined;
    out.push(scaled !== undefined && scaled !== n ? [n, scaled] : [n]);
  }
  return out;
}

/** Every number a quote states, in digits or as a number word ("seven", "чотири"). */
export function figuresIn(text: string): number[] {
  const words = (fold(text).match(WORD) ?? [])
    .filter((w) => !/\d/.test(w))
    .map((w) => parseNumber(w))
    .filter((n): n is number => n !== undefined);
  return [...digitFigures(text).flat(), ...words];
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

/** Words that carry no content of their own; a text value matching only these matches nothing. */
const FILLER = new Set(["the", "and", "with", "for", "from", "that", "this", "its", "are", "was"]);

const contentWords = (text: string) =>
  (fold(text).match(WORD) ?? []).filter((w) => w.length >= 3 && !FILLER.has(w));

/** Share of a text value's words the quote must contain for the quote to be said to state it. */
const TEXT_OVERLAP = 0.5;

/** Words in a figure's reading beyond which it is a sentence, not a statement of the figure. */
const SENTENCE_WORDS = 12;

/**
 * A figure whose reading is a sentence: "Anthem … has declared cost of less than $1 million per
 * unit, engagement range up to 1,500 kilometers, and warhead up to 200 kilograms" stored as a
 * unit cost of 1,000,000. The figure was parsed out of it and its bound ("less than") lost, and
 * a sentence always contains itself, so the quote check alone would pass it.
 */
export function readsAsSentence(value: unknown, raw: string | undefined): boolean {
  const figure = typeof value === "number" || /^\s*-?[\d.,\s]+\s*$/.test(String(value ?? ""));
  return figure && !!raw && raw.trim().split(/\s+/).length >= SENTENCE_WORDS;
}

export type ValueInQuote =
  { applicable: false } | { applicable: true; stated: boolean; detail: string };

/**
 * `value` is the claim as the source worded it (`raw`, else the stored value). A value written
 * with digits is stated when every figure in it is in the quote, under any of its readings; a
 * text value when at least half its words are.
 */
export function valueInQuote(value: string, quote: string): ValueInQuote {
  if (!value.trim() || !quote.trim()) return { applicable: false };
  const word = parseNumber(value);
  const figures = word !== undefined && !/\d/.test(value) ? [[word]] : digitFigures(value);
  if (figures.length > 0) {
    const quoted = figuresIn(quote);
    const stated = figures.every((readings) =>
      readings.some((n) => quoted.some((q) => same(n, q))),
    );
    return stated
      ? { applicable: true, stated, detail: "the quote states this figure" }
      : { applicable: true, stated, detail: "the quote does not state this figure" };
  }
  const words = contentWords(value);
  if (words.length === 0) return { applicable: false };
  const inQuote = new Set(contentWords(quote));
  const stated = words.filter((w) => inQuote.has(w)).length / words.length >= TEXT_OVERLAP;
  return stated
    ? { applicable: true, stated, detail: "the quote states this value" }
    : { applicable: true, stated, detail: "the quote does not contain this value's words" };
}
