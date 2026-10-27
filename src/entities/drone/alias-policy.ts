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
