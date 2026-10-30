/**
 * System-name detection and catalog resolution. Pure text logic: exact token boundaries keep
 * variant numbers strict ("Geran-2" never matches "Geran-5"), phonetic keys bridge scripts.
 */
import { mentionsPhonetic, phoneticKey } from "@/entities/drone/name-key";
import { cleanAliasList, isFamilyAlias } from "@/entities/drone/alias-policy";
import type { DetectedSystem, Drone } from "@/entities/drone/types";
import { getRe } from "./regex-cache";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact token-boundary match: "Geran-2" never matches inside "Geran-5" or "Geran-25". */
export function mentions(text: string, name: string) {
  if (name.trim().length < 2) return false;
  return getRe(`(?<![\\p{L}\\p{N}-])${esc(name.trim())}(?![\\p{L}\\p{N}]|-\\p{N})`, "iu").test(
    text,
  );
}

const STOP = new Set(
  (
    "Telegram Russian Russia Ukrainian Ukraine Iranian Iran Chinese China The A An In On At Of And Or But New Our We They It This That These Those " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
    // Cyrillic calendar words are not system names: "Февраль" (February) sat as a Lyutyi alias and
    // auto-merged a Starlink post into its dossier. Ukrainian months are omitted on purpose —
    // "Лютий" (February) IS the FP-1/Lyutyi name and must stay matchable.
    "Январь Февраль Март Апрель Май Июнь Июль Август Сентябрь Октябрь Ноябрь Декабрь " +
    "MHz GHz CRPA GNSS GPS FPV UAV UAVs USV UGV EW AI RF HD km kg USD EUR UAH RUB Air Land Sea Defense Defence Forces Army Navy Report Dispatch Update Source Sources " +
    "Also New One Two Three Several Later Then After Before Near Meanwhile Reportedly Estimated Price Cost Unit Russians Ukrainians Kyiv Moscow Kharkiv Odesa Donetsk Crimea Black Front Western Eastern Southern Northern Sea Oblast"
  )
    .split(" ")
    .map((w) => w.toLowerCase()),
);

/**
 * mentions(), or the same name in another script or romanisation ("Ланцетом" for Lancet). For
 * catalog matching; detectNames keeps the exact form, since a novel name is not yet known.
 */
export function mentionsName(text: string, name: string) {
  return mentions(text, name) || mentionsPhonetic(text, name);
}

/** Find proper nouns, acronyms and model designations without requiring quotes. */
export function detectNames(raw: string, extraStop?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const isStop = (w: string) => STOP.has(w) || !!extraStop?.has(w);
  const add = (s: string) => {
    const words = s
      .trim()
      .replace(/[.,;:!?)]+$/, "")
      .split(/\s+/);
    while (words.length > 1 && isStop(words[0]!.toLowerCase())) words.shift();
    const n = words.join(" ");
    if (n.length < 2 || isStop(n.toLowerCase())) return;
    if (n.split(/\s+/).every((w) => isStop(w.toLowerCase()))) return;
    if (!out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  for (const m of raw.matchAll(/["«“']([^"»”']{2,40})["»”']/g)) add(m[1]!);
  // Designations: Geran-5, Molniya-1, FP-1, Lancet-3M, Shahed-238, \u041B\u0430\u043D\u0446\u0435\u0442-3\u041C. Lookarounds rather
  // than \b, which only knows ASCII letters and so never matched before a Cyrillic name.
  for (const m of raw.matchAll(
    /(?<![\p{L}\p{N}])([A-Z\u0410-\u042F][\p{L}]*(?:\s[A-Z\u0410-\u042F][\p{L}]+)?-\p{N}+[A-Za-z\u0410-\u044F]?)(?![\p{L}\p{N}])/gu,
  )) {
    // A capability adjective is not part of the designation: "SUPERSONIC UAV-300" describes the
    // UAV-300 in a headline, and naming it whole promoted a munition as its own catalog entry.
    add(m[1]!.replace(CAPABILITY_ADJECTIVE, ""));
  }
  // Acronym names, optionally with a single-letter variant: STING S, MAGURA V5
  for (const m of raw.matchAll(/\b([A-Z]{3,}(?:\s(?:[A-Z]\d*|V\d+)\b)?)/g)) {
    if (isTitleLine(raw, m.index)) continue;
    add(m[1]!);
  }
  // Capitalised 1–2 word phrases not at sentence start: Baba Yaga, Bars, Magura V5. A Roman
  // numeral stays with its name ("Lightning II", "Reaper III"): read without it, the name is
  // a different one, and a report using only the nickname proposed an entry called "Lightning".
  for (const m of raw.matchAll(
    /\b([A-Z][a-z]{2,}\s(?:[A-Z][a-z]{2,}|[A-Z]\d+)(?:\s(?:II|III|IV)(?![\p{L}\p{N}]))?)\b/gu,
  )) {
    if (isTitleLine(raw, m.index)) continue;
    add(m[1]!);
  }
  for (const m of raw.matchAll(
    /(?<=[a-z0-9,;:()]\s)([A-Z][a-z]{2,}(?:\s(?:II|III|IV)(?![\p{L}\p{N}]))?)\b/gu,
  )) {
    if (isTitleLine(raw, m.index)) continue;
    add(m[1]!);
  }
  // Drop names that are prefixes of a longer detected designation (Geran vs Geran-5)
  return dropContained(out, out);
}

/**
 * The adjectives that describe a capability rather than name a system. Every drone headline
 * contains at least one, and "SUPERSONIC UAV-300" is the failure this list exists for: the
 * adjective and the designation were read as one name.
 */
const CAPABILITY_ADJECTIVE =
  /^(?:SUPERSONIC|HYPERSONIC|LOITERING|KAMIKAZE|STEALTH|INTERCEPTOR|ONE[- ]WAY|COMBAT|TACTICAL|STRATEGIC)\s+/i;

/**
 * True when the match sits on a line carrying three or more capitalised tokens - a headline,
 * not a sentence. "AKINCI STRIKES WITH SUPERSONIC UAV-300 MISSILE!" reads STRIKES, WITH and
 * MISSILE as system names otherwise, which is how a munition from one press-release title was
 * promoted into the catalog as its own entry. Body prose ("The AKINCI carried the UAV-300
 * missile") has two such tokens and is unaffected; a sentence written entirely in capitals is
 * the cost of the rule, and under-detecting a name there is the safe direction to fail.
 */
function isTitleLine(raw: string, at: number | undefined): boolean {
  if (at === undefined) return false;
  const from = raw.lastIndexOf("\n", at) + 1;
  const to = raw.indexOf("\n", at);
  const line = raw.slice(from, to === -1 ? raw.length : to);
  return (line.match(/\b[A-Z][A-Z0-9-]{2,}\b/g) ?? []).length >= 3;
}

/** Remove names that are a word-part of a longer name (Geran ⊂ Geran-5, Yaga ⊂ Baba Yaga). */
function dropContained(names: string[], against: string[]) {
  return names.filter(
    (n) =>
      !against.some(
        (o) =>
          o.toLowerCase() !== n.toLowerCase() &&
          mentions(o.replace(/-/g, " "), n.replace(/-/g, " ")) &&
          o.length > n.length,
      ),
  );
}

/**
 * Names a catalog entry may be resolved by. Aliases pass the intake policy at match time too, so
 * a generic phrase already stored before the guard existed (or injected by a dynamic rule) never
 * captures a mention: "interceptor drones" resolves nothing, "Bars interceptor drones" resolves
 * the Bars entry.
 */
const catalogNames = (d: Drone) =>
  [
    ...d.name.split(/\s*\/\s*/),
    d.name,
    d.cyrillic ?? "",
    // A family alias stored before the guard ("F-35" on F-35A) stays on the record for the
    // analyst to clean up, but no longer files a sibling's report under this entry.
    ...cleanAliasList(d.aliases).filter((a) => !isFamilyAlias(a, [d.name, d.cyrillic])),
  ].filter((n) => n.length > 2 && !STOP.has(n.toLowerCase()));
/**
 * The ways a designation splits into a family stem and a variant, for "is this new name a
 * variant of a catalog entry?". Two names are variants when any of their splits share a stem
 * and differ in the variant.
 * - "Orlan-30" → orlan / 30. The stem must carry identity: two letters at least, since a
 *   one-letter mission prefix is not a family ("F" in F-16 and F-35, "B" in B-52).
 * - "F-35B" → f-35 / b. A trailing letter after the number is the variant of that designation.
 * - "F-35" → f-35 / (none). A bare designation is the family its lettered variants belong to.
 */
const bases = (n: string): { stem: string; variant: string }[] => {
  const s = n.toLowerCase().trim();
  const out: { stem: string; variant: string }[] = [];
  const numbered = s.match(/^(.*?)-(\p{N}+\w*)$/u);
  if (numbered && (numbered[1]!.match(/\p{L}/gu)?.length ?? 0) >= 2)
    out.push({ stem: numbered[1]!, variant: numbered[2]! });
  const lettered = s.match(/^(.*\p{L}.*\p{N})(\p{L}{1,2})$/u);
  if (lettered) out.push({ stem: lettered[1]!, variant: lettered[2]! });
  if (/\p{L}.*\p{N}$/u.test(s)) out.push({ stem: s, variant: "" });
  return out;
};
const sameFamily = (a: string, b: string) =>
  bases(a).some((x) =>
    bases(b).some((y) => phoneticKey(x.stem) === phoneticKey(y.stem) && x.variant !== y.variant),
  );

export function resolveSystems(
  raw: string,
  catalog: Drone[],
  extraStop?: ReadonlySet<string>,
): DetectedSystem[] {
  const systems: DetectedSystem[] = [];
  const seen = new Set<string>();
  // 1. Catalog mentions, in any script or romanisation ("Ланцет" finds Lancet)
  for (const d of catalog) {
    const hit = catalogNames(d).find((n) => mentionsName(raw, n));
    if (hit && !seen.has(d.id)) {
      seen.add(d.id);
      systems.push({ name: hit, matchId: d.id });
    }
  }
  // 2. Detected names not already covered — check for variant-of relations
  for (const n of dropContained(
    detectNames(raw, extraStop),
    systems.map((s) => s.name),
  )) {
    // Compared by phonetic key, so a Cyrillic spelling of a matched system is not a new one.
    const key = phoneticKey(n);
    if (systems.some((s) => phoneticKey(s.name) === key)) continue;
    if (catalog.some((d) => catalogNames(d).some((c) => phoneticKey(c) === key))) continue;
    const parent = catalog.find((d) => catalogNames(d).some((c) => sameFamily(n, c)));
    systems.push({ name: n, ...(parent ? { variantOf: parent.id } : {}) });
  }
  return systems;
}
