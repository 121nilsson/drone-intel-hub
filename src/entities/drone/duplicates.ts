import type { Drone } from "./types";
import { phoneticKey } from "./name-key";

export interface DuplicateGroup {
  /** Stable for React keys and per-group UI state: the sorted member ids. */
  key: string;
  name: string;
  drones: Drone[];
  ids: string[];
  /** Why these were grouped, for the analyst deciding whether to merge. */
  reasons: string[];
}

/** Keys shorter than this ("ka", "s3") are too common to mean anything once folded. */
const MIN_KEY = 3;

/**
 * Catalog entries that are probably the same system, for the Catalog page's merge suggestions.
 *
 * Linked when:
 * - their names or Cyrillic names have the same phonetic key ("Ланцет-3" / "Lancet-3",
 *   "Shahed 136" / "Shahed-136");
 * - one's name is another's alias ("Geran-2" on the Shahed-136 card). Alias-to-alias overlap
 *   does not count: a shared "Shahed" alias would otherwise group Shahed-136 with Shahed-238,
 *   the same rule the reference import follows;
 * - they point at the same Wikidata item.
 *
 * Groups are transitive (A~B and B~C puts all three together) and are only suggestions: merging
 * stays an analyst action.
 */
export function duplicateGroups(drones: readonly Drone[]): DuplicateGroup[] {
  const parent = drones.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const reasons = new Map<number, Set<string>>();
  const union = (a: number, b: number, why: string) => {
    const ra = find(a);
    const rb = find(b);
    const merged = new Set([...(reasons.get(ra) ?? []), ...(reasons.get(rb) ?? []), why]);
    if (ra !== rb) parent[rb] = ra;
    reasons.set(find(a), merged);
  };

  const byNameKey = new Map<string, number>();
  const byWikidata = new Map<string, number>();
  drones.forEach((d, i) => {
    for (const name of [d.name, d.cyrillic ?? ""]) {
      const key = phoneticKey(name);
      if (key.length < MIN_KEY) continue;
      const other = byNameKey.get(key);
      if (other === undefined) byNameKey.set(key, i);
      else if (other !== i) union(other, i, "same name in another spelling");
    }
    for (const id of [d.reference?.wikidataId, ...(d.reference?.alsoIds ?? [])]) {
      if (!id) continue;
      const other = byWikidata.get(id);
      if (other === undefined) byWikidata.set(id, i);
      else if (other !== i) union(other, i, `same Wikidata item (${id})`);
    }
  });
  drones.forEach((d, i) => {
    for (const alias of d.aliases) {
      const other = byNameKey.get(phoneticKey(alias));
      if (other !== undefined && other !== i)
        union(other, i, `"${alias}" is an alias of one and the name of another`);
    }
  });

  const groups = new Map<number, number[]>();
  drones.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const group = members.map((i) => drones[i]!);
      const ids = group.map((d) => d.id);
      return {
        key: [...ids].sort().join("|"),
        name: group[0]!.name,
        drones: group,
        ids,
        reasons: [...(reasons.get(root) ?? [])],
      };
    });
}
