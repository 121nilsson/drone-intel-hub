import { phoneticKey, phoneticText } from "./name-key";
import { declined, parentListing, storedEdges } from "./system-hierarchy";
import type { AliasClaim, Drone } from "./types";

/**
 * What the catalogue's families look like they should be, as proposals for the analyst: never
 * applied here. Identity is the high-risk tier of the autonomy plan (§4.5) - an alias decides
 * which entry a report is filed under - so every change goes through a person.
 *
 * Pure, and read from the catalogue's own names, so it works for any family, not a list of
 * known ones:
 * - an entry that others are numbered after ("Geran" → Geran-2, Geran-3) is a family;
 * - a numbered entry not yet linked to it is a variant of it;
 * - a name filed in the wrong place: an alias that is another entry's own name ("Geran" on
 *   Shahed-131), or a designation carried as a family's alias ("Shahed-136" on Geran);
 * - an entry with the family's names under another spelling is the same family, to be merged.
 */

export type FamilyProposal =
  | { kind: "family_class"; id: string; droneId: string; reason: string }
  | { kind: "variant_link"; id: string; sourceId: string; targetId: string; reason: string }
  | {
      kind: "alias_conflict";
      id: string;
      droneId: string;
      aliasClaimId: string;
      alias: string;
      reason: string;
    }
  | { kind: "merge"; id: string; keepId: string; mergeId: string; reason: string };

/** A designation: letters then a number ("Shahed-136", "Ланцет-3"), not a family's name. */
const isDesignation = (alias: string) => /\p{L}[\s-]?\d{2,}/u.test(alias);

/** The alias claims that feed an entry's identity and that no analyst has ruled on. */
const openAliases = (d: Drone): AliasClaim[] =>
  (d.aliasClaims ?? []).filter((c) => !c.review && c.status === "verified");

export function familyProposals(catalog: readonly Drone[]): FamilyProposal[] {
  const out: FamilyProposal[] = [];
  const families = new Map<string, Drone[]>();

  // A family is what two or more entries are numbered after, or what the analyst has called one.
  // An entry that merely has variants linked to it is a platform with variants (F-35A, Patriot),
  // which variant_of describes without making it an umbrella.
  //
  // Found by prefix, each name folded once: "geran 2" is numbered after whichever entry is called
  // "geran". Comparing every pair re-folded both names each time, a stall on a page that re-runs
  // this on every catalogue change.
  const byFolded = new Map<string, Drone[]>();
  for (const d of catalog) {
    const k = phoneticText(d.name);
    if (k) byFolded.set(k, [...(byFolded.get(k) ?? []), d]);
  }
  const numbered = new Map<string, Drone[]>();
  for (const v of catalog) {
    const n = phoneticText(v.name);
    for (let i = n.indexOf(" "); i > 0; i = n.indexOf(" ", i + 1)) {
      if (!/^\d+[a-z]{0,2}$/.test(n.slice(i + 1).replace(/ /g, ""))) continue;
      for (const f of byFolded.get(n.slice(0, i)) ?? [])
        if (f.id !== v.id) numbered.set(f.id, [...(numbered.get(f.id) ?? []), v]);
    }
  }
  for (const f of catalog) {
    const variants = numbered.get(f.id) ?? [];
    if (variants.length >= 2 || f.systemClass === "family") families.set(f.id, variants);
  }
  const byId = new Map(catalog.map((d) => [d.id, d]));
  const member = new Set([...numbered.values()].flat().map((d) => d.id));

  for (const [familyId, variants] of families) {
    const f = byId.get(familyId)!;
    if (!f.systemClass)
      out.push({
        kind: "family_class",
        id: `family_class:${f.id}`,
        droneId: f.id,
        reason: `${variants.map((v) => v.name).join(", ")} are numbered after it`,
      });
  }

  for (const [familyId, variants] of numbered) {
    const f = byId.get(familyId)!;
    for (const v of variants) {
      // Linked already - by its own pointer or the parent's legacy list - or turned down.
      if (storedEdges(v).some((e) => e.kind === "variant_of")) continue;
      if (parentListing(v, catalog) || declined(v, f.id, "variant_of")) continue;
      out.push({
        kind: "variant_link",
        id: `variant_link:${v.id}:${f.id}`,
        sourceId: v.id,
        targetId: f.id,
        reason: `${v.name} is numbered after ${f.name}`,
      });
    }
  }

  // Names filed in the wrong place.
  const byNameKey = new Map<string, Drone>();
  for (const d of catalog) {
    const k = phoneticKey(d.name);
    if (k.length >= 3 && !byNameKey.has(k)) byNameKey.set(k, d);
  }
  for (const d of catalog) {
    const family = families.has(d.id);
    for (const c of openAliases(d)) {
      const owner = byNameKey.get(phoneticKey(c.alias));
      if (owner && owner.id !== d.id) {
        out.push({
          kind: "alias_conflict",
          id: `alias_conflict:${d.id}:${c.id}`,
          droneId: d.id,
          aliasClaimId: c.id,
          alias: c.alias,
          reason: `"${c.alias}" is the name of ${owner.name}; filed here, its reports land on ${d.name}`,
        });
      } else if (family && isDesignation(c.alias)) {
        out.push({
          kind: "alias_conflict",
          id: `alias_conflict:${d.id}:${c.id}`,
          droneId: d.id,
          aliasClaimId: c.id,
          alias: c.alias,
          reason: `"${c.alias}" is a designation; on the ${d.name} family it files that model's reports under the whole family`,
        });
      }
    }
  }

  // Another entry that is the same family under another spelling: most of the names either one
  // answers to are the other's too. Compared directly, pair by pair - duplicate grouping is
  // transitive, and through poisoned aliases it chained Banderol and Shahed-131 onto Geran.
  const names = (d: Drone) =>
    new Set(
      [d.name, d.cyrillic ?? "", ...(d.aliases ?? [])]
        .map(phoneticKey)
        .filter((k) => k.length >= 3),
    );
  // A numbered variant of any family is that family's member, never a duplicate of another.
  const isVariant = (d: Drone) => member.has(d.id);
  const proposedPairs = new Set<string>();
  for (const familyId of families.keys()) {
    const f = byId.get(familyId)!;
    const fn = names(f);
    for (const other of catalog) {
      if (other.id === f.id || isVariant(other)) continue;
      const on = names(other);
      const shared = [...on].filter((k) => fn.has(k)).length;
      const overlap = shared / Math.min(fn.size, on.size);
      if (shared < 3 || overlap < 0.5) continue;
      // The analyst has said these are different systems.
      if (f.distinctFrom?.includes(other.id) || other.distinctFrom?.includes(f.id)) continue;
      const pair = [f.id, other.id].sort().join("|");
      if (proposedPairs.has(pair)) continue;
      proposedPairs.add(pair);
      // Keep the entry more variants are numbered after; on a tie, the older one.
      const fScore = numbered.get(f.id)?.length ?? 0;
      const oScore = numbered.get(other.id)?.length ?? 0;
      const keepOther =
        oScore > fScore || (oScore === fScore && (other.createdAt ?? "") < (f.createdAt ?? ""));
      const [keep, merge] = keepOther ? [other, f] : [f, other];
      out.push({
        kind: "merge",
        id: `merge:${keep.id}:${merge.id}`,
        keepId: keep.id,
        mergeId: merge.id,
        reason: `${merge.name} answers to ${shared} of the same names as ${keep.name}`,
      });
    }
  }
  return out;
}
