import { cleanAliasList, isFamilyAlias } from "./alias-policy";
import type { Drone } from "./types";

/**
 * The names a catalog entry is recognised by, shared by the extractor (resolveSystems in
 * shared/infra/heuristics/names.ts) and the verifier (entities/drone/verification.ts), so the two
 * can never disagree about which words name a system.
 */

/** Words that are never a system name, however they were stored. */
export const NAME_STOPWORDS: ReadonlySet<string> = new Set(
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

interface Memo {
  name: string;
  cyrillic: string | undefined;
  aliases: readonly string[];
  names: string[];
}

/**
 * Per entry, because a post or a backfill checks every entry's names in a row. Validated against
 * the fields it was built from, so an entry edited in place is never matched on stale names.
 */
const memo = new WeakMap<Drone, Memo>();

/**
 * Names a catalog entry may be resolved by. Aliases pass the intake policy at match time too, so
 * a generic phrase already stored before the guard existed (or injected by a dynamic rule) never
 * captures a mention: "interceptor drones" resolves nothing, "Bars interceptor drones" resolves
 * the Bars entry.
 */
export function catalogNames(d: Drone): string[] {
  const hit = memo.get(d);
  if (hit && hit.name === d.name && hit.cyrillic === d.cyrillic && hit.aliases === d.aliases)
    return hit.names;
  const names = [
    ...d.name.split(/\s*\/\s*/),
    d.name,
    d.cyrillic ?? "",
    // A family alias stored before the guard ("F-35" on F-35A) stays on the record for the
    // analyst to clean up, but no longer files a sibling's report under this entry.
    ...cleanAliasList(d.aliases).filter((a) => !isFamilyAlias(a, [d.name, d.cyrillic])),
  ].filter((n) => n.length > 2 && !NAME_STOPWORDS.has(n.toLowerCase()));
  memo.set(d, { name: d.name, cyrillic: d.cyrillic, aliases: d.aliases, names });
  return names;
}
