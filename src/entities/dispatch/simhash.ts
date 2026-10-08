/**
 * Near-duplicate fingerprinting for collected posts.
 *
 * One story routinely arrives three times over: a Telegram channel, an RSS feed and a news site
 * all report the same event within minutes, with different framing and boilerplate. Ingesting all
 * three means three model calls, three candidates, and - worse - three `SpecClaim`s each citing a
 * different `source`, so `consensus()` counts one fact three times and clears its
 * `sources >= 3` "high confidence" gate on the strength of a single report.
 *
 * Exact hashing cannot help here, because the text genuinely differs. SimHash can: it is a
 * 64-bit fingerprint of the token set, so two reports about the same story land a few bits apart
 * while unrelated reports land ~32 apart.
 *
 * Design notes, since they are easy to undo by accident:
 * - **Order-insensitive.** A fingerprint is a sum over features, not a sequence. Telegram
 *   forwards and re-ordered paragraphs are what we most want to catch, so this is the feature.
 * - **Unigrams + bigrams.** Bigrams give word order *within* the fingerprint's tolerance, so a
 *   re-ordered sentence still matches while a different sentence about the same event does not
 *   drift arbitrarily.
 * - **URLs are stripped.** They are the one part guaranteed to differ between copies.
 * - **Synchronous and dependency-free.** `collectSource` fingerprints every post it fetches;
 *   going through `crypto.subtle` (async) would complicate a simple loop for no gain.
 */

/** Below this length a fingerprint is unstable, so short posts are never compared. */
export const MIN_CHARS_FOR_DEDUPE = 120;

/**
 * How many of the 64 bits may differ and still be called the same story.
 *
 * Chosen by measurement, not instinct. Against a sample of OSINT-style reports:
 *
 * | case                                  | bits |
 * |---------------------------------------|------|
 * | reworded copy / attribution appended  |   7-8 |
 * | sentences reordered, words unchanged  |     1 |
 * | unrelated reports, even at 120 chars  |  23-36 |
 *
 * The same-story cluster tops out around 8 and the nearest unrelated pair sits at 23, so ten
 * leaves headroom on the match side and more than double the margin on the reject side. This is
 * the single dial that trades recall for false merges - move it with this table, not by feel:
 * collapsing two real stories silently drops a system's only report.
 */
export const DUPLICATE_TOLERANCE = 10;

/** A 64-bit fingerprint is 16 hex characters; anything else is "no fingerprint". */
const FINGERPRINT_LENGTH = 16;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** A second seed, so the high 32 bits are independent of the low 32. */
const FNV_SEED = 0x9e3779b9;

/**
 * Lowercase, drop URLs, drop punctuation, collapse whitespace. `\p{L}`/`\p{N}` with the `u` flag
 * keeps Cyrillic words intact, which matters here more than for any other parser in the app.
 */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a over UTF-16 code units. Not cryptographic; it only needs to be fast and even. */
function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

function tokenFeatures(text: string): string[] {
  const tokens = normalizeForHash(text)
    .split(" ")
    .filter((t) => t.length > 1);
  // Prefixes keep a unigram from colliding with a bigram of the same words.
  const features = tokens.map((t) => `w:${t}`);
  for (let i = 0; i + 1 < tokens.length; i++) features.push(`b:${tokens[i]} ${tokens[i + 1]}`);
  return features;
}

/**
 * 64-bit SimHash as 16 lowercase hex characters (high 32 bits first).
 * Returns "" for text with no features, so an empty or punctuation-only string never matches.
 */
export function simHash64(text: string): string {
  const features = tokenFeatures(text);
  if (features.length === 0) return "";

  const counts = new Int8Array(64);
  for (const feature of features) {
    const words = [fnv1a(feature, FNV_OFFSET), fnv1a(feature, FNV_SEED)];
    for (let w = 0; w < 2; w++) {
      const bits = words[w]!;
      for (let b = 0; b < 32; b++) {
        counts[w * 32 + b] += ((bits >>> b) & 1) === 1 ? 1 : -1;
      }
    }
  }

  let hex = "";
  for (let w = 0; w < 2; w++) {
    let word = 0;
    for (let b = 0; b < 32; b++) {
      if (counts[w * 32 + b]! > 0) word |= 1 << b;
    }
    hex += (word >>> 0).toString(16).padStart(8, "0");
  }
  return hex;
}

function popcount(n: number): number {
  let x = n - ((n >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/** Bits that differ between two fingerprints. 64 (everything) when either is not a fingerprint. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== FINGERPRINT_LENGTH || b.length !== FINGERPRINT_LENGTH) return 64;
  let distance = 0;
  for (let half = 0; half < 2; half++) {
    const offset = half * 8;
    const x = Number.parseInt(a.slice(offset, offset + 8), 16) >>> 0;
    const y = Number.parseInt(b.slice(offset, offset + 8), 16) >>> 0;
    distance += popcount((x ^ y) >>> 0);
  }
  return distance;
}

/** True when two fingerprints are close enough to be the same story. */
export function isNearDuplicate(
  a: string,
  b: string,
  tolerance: number = DUPLICATE_TOLERANCE,
): boolean {
  if (!a || !b) return false;
  return hammingDistance(a, b) <= tolerance;
}
