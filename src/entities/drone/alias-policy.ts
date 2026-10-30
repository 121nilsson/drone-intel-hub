/**
 * Alias intake policy: what a catalog entry may carry as an alias.
 *
 * A model-suggested alias must be distinctive. A bare generic noun phrase ("interceptor drones",
 * "attack drones", "cruise missile-drone") names a class of systems, not one system - once
 * accepted it resolves every later mention of that class onto this entry's dossier, which is how
 * a Defense Express Patriot post was filed under Bars (its alias list held "interceptor drones",
 * Oct 2026). An alias with a real stem ("Bars interceptor drones") stays: the stem carries the
 * identity and the generic tail only widens the form.
 *
 * Domain data, not configuration: closed word lists like the capability adjectives in
 * heuristics/names.ts, kept pure so promote, the merge path and match-time resolution share one
 * definition of "generic".
 */

import { phoneticKey } from "./name-key";

/** Category head nouns a class phrase ends with ("… drones", "loitering munitions"). */
const CATEGORY_HEADS = new Set(
  (
    "drone drones uav uavs uas usv usvs ugv ugvs cuav " +
    "missile missiles rocket rockets munition munitions " +
    "aircraft airframe vehicle vehicles system systems platform platforms " +
    "target targets swarm swarms"
  ).split(" "),
);

/**
 * Capability and context descriptors that chain in front of a head. Alone, or before a head, they
 * describe a class; they never carry identity ("Clark Interceptor" stays distinct because "Clark"
 * survives stripping).
 */
const CAPABILITY_WORDS = new Set(
  (
    "attack strike strikes kamikaze suicide loitering " +
    "one way jet powered cruise ballistic hypersonic supersonic subsonic " +
    "combat tactical strategic operational " +
    "reconnaissance recon surveillance " +
    "aerial air airborne aviation naval maritime surface ground " +
    "unmanned autonomous armed crewed " +
    "small light heavy fast slow " +
    "fpv first person view " +
    "interceptor interceptors " +
    "defense defence " +
    "russian ukrainian iranian iran army military forces " +
    "new"
  ).split(" "),
);

/** Words that glue a phrase together and cannot rescue a stripped tail ("family of …"). */
const FILLERS = new Set(["a", "an", "the", "of", "and", "or", "for"]);

/** Words of an alias after folding to lowercase letter/digit tokens ("one-way" = two words). */
function words(alias: string): string[] {
  return alias
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter(Boolean);
}

/**
 * The distinctive prefix of an alias: everything left after consuming the trailing chain of
 * category heads and capability words. Empty when the alias is a bare generic phrase.
 */
export function aliasStem(alias: string): string {
  const w = words(alias);
  let i = w.length;
  while (i > 0 && (CATEGORY_HEADS.has(w[i - 1]!) || CAPABILITY_WORDS.has(w[i - 1]!))) i--;
  return w
    .slice(0, i)
    .filter((x) => !FILLERS.has(x))
    .join(" ");
}

/** True when the alias is a bare generic class phrase with no distinctive stem. */
export function isGenericAlias(alias: string): boolean {
  const stem = aliasStem(alias);
  return stem === "" && words(alias).length > 0;
}

/**
 * The family names an entry's own designation implies: "F-35" for "F-35A" (and for
 * "F-35A Lightning II"). The variant letter is what makes the designation this entry; without
 * it the name fits every sibling - F-35B and F-35C answer to "F-35" just as well.
 */
function familyFolds(names: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const name of names)
    for (const m of (name ?? "").matchAll(
      /(?<![\p{L}\p{N}])(\p{L}+[- ]?\p{N}+)\p{L}{1,2}(?![\p{L}\p{N}])/gu,
    )) {
      const fold = aliasFold(m[1]!);
      if (fold) out.push(fold);
    }
  return out;
}

/**
 * True when the alias is the entry's designation without its variant letter ("F-35" or
 * "F-35s" on F-35A): a family name, which an alias would turn into a claim that every sibling's
 * report is about this one entry. The family belongs on a parent entry, if anywhere.
 */
export function isFamilyAlias(alias: string, ownNames: readonly (string | undefined)[]): boolean {
  const fold = aliasFold(alias);
  if (!fold) return false;
  const families = familyFolds(ownNames);
  return families.includes(fold) || pluralIdentities(fold).some((p) => families.includes(p));
}

/**
 * The catalog form of an alias list: trimmed, de-duplicated case-insensitively, closed over
 * generic phrases, and (optionally) not the entry's own name. Existing lists pass through
 * unchanged in content - order is preserved - so a cleaned list only ever removes entries.
 */
export function cleanAliasList(list: readonly string[], notName?: string): string[] {
  const seen = new Set<string>();
  const ownName = notName?.trim().toLowerCase();
  const out: string[] = [];
  for (const item of list) {
    const alias = item.trim();
    if (!alias || isGenericAlias(alias)) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    if (ownName && key === ownName) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/**
 * Cyrillic case endings of a system name, so Ukrainian "Шахедів/Шахедах", Russian
 * "Шахедов/Шахедом" and their dative forms all reduce to the one stored lemma ("Шахед").
 * Long endings must leave a stem of at least 3 characters, bare vowels at least 4, so
 * "Шахеда" trims but a 3-letter name ("Сеч", "Оса") never disappears into its ending.
 */
const LONG_ENDINGS = [
  "ами",
  "ями",
  "ого",
  "его",
  "ому",
  "ему",
  "ими",
  "ыми",
  "ів",
  "ах",
  "ях",
  "ов",
  "ев",
  "ей",
  "ою",
  "ею",
  "их",
  "ых",
  "ом",
  "ем",
  "ам",
  "ям",
  "ой",
];
const VOWEL_ENDINGS = ["и", "і", "а", "я", "у", "ю", "е", "о", "ы"];

/** Latin look-alikes of the Cyrillic letters most often pasted with one wrong glyph. */
const HOMOGLYPHS: Record<string, string> = {
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
};

/**
 * The alias without its trailing Slavic case endings. Latin words pass through untouched; an
 * alias that is already mixed-script ("Шелахaх" with a Latin a) is a look-alike artifact, not
 * a Latin word, so its Latin letters are read as the Cyrillic ones they were pasted as before
 * its endings are matched.
 */
export function aliasLemma(alias: string): string {
  let s = alias.trim();
  if (!s) return s;
  if (/[а-яёіїєґ]/i.test(s))
    s = s.replace(/[aceopxy]/gi, (ch) => HOMOGLYPHS[ch.toLowerCase()] ?? ch);
  for (;;) {
    const lower = s.toLowerCase();
    const long = LONG_ENDINGS.find((e) => lower.endsWith(e) && s.length - e.length >= 3);
    const vowel = VOWEL_ENDINGS.find((e) => lower.endsWith(e) && s.length - e.length >= 4);
    const cut = long ? long.length : vowel ? vowel.length : 0;
    if (!cut) return s;
    s = s.slice(0, s.length - cut);
  }
}

/**
 * Dedupe/migration key for an alias: the phonetic key of its lemma, so "Шахедів" and
 * "Шахедах" share one claim and the Latin-a lookalike "Шелахaх" folds into "Шелахах".
 */
export function aliasFold(alias: string): string {
  return phoneticKey(aliasLemma(alias));
}

/**
 * The folded keys a name's bare singular and plural share. The t/s tail swap covers the fold
 * itself: folds turn "Patriots" into "patrios" ("ts"→"s"), so "patriot" cannot reach it by
 * appending an "s" alone. Shared by duplicate bridging and alias conflict checks.
 */
export function pluralIdentities(key: string): string[] {
  const alts: string[] = [];
  if (key.endsWith("s")) {
    const base = key.slice(0, -1);
    alts.push(base, `${base}t`);
  } else {
    alts.push(`${key}s`);
    if (key.endsWith("t")) alts.push(`${key.slice(0, -1)}s`);
  }
  return alts;
}
