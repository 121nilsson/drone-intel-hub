import type { Drone, Extraction } from "./types";

/**
 * Relationship edges from an extraction.
 *
 * The extractor already reports `systems[]` (with `matchId` / `variantOf`) and the pipeline
 * already persisted it on the candidate, but nothing ever turned those into catalog
 * relations. These helpers close that loop so counterpart links come from ingest instead of
 * being hand-maintained. Pure functions: callers own persistence.
 */

const norm = (s: string) => s.toLowerCase().normalize("NFKD").trim();

/**
 * Resolve one detected system name to a catalog id. Exact name and cyrillic matches win over
 * alias matches, because in this catalog a name can be another entry's alias (Shahed-136 is
 * also sold as Geran-2, while Geran-2 is a distinct designation) and picking the alias first
 * would misattribute reports to the wrong record.
 */
export function resolveSystemId(name: string, catalog: Drone[]): string | undefined {
  const n = norm(name);
  if (!n) return undefined;
  const exact = catalog.find(
    (d) => norm(d.name) === n || (d.cyrillic ? norm(d.cyrillic) === n : false),
  );
  if (exact) return exact.id;
  // `aliases` is required by the type, but documents live in schemaless JSONB and can be
  // hand-edited or seeded externally, so tolerate a missing array rather than throwing.
  // Throwing here would abort an entire sync pass, not just one source.
  return catalog.find((d) => (d.aliases ?? []).some((a) => norm(a) === n))?.id;
}

/**
 * Catalog ids this extraction says are related to `targetId`, excluding the target itself.
 * Reads `matchId` and `variantOf` first, then falls back to name resolution so a report
 * that names a known system without an explicit catalog id still links.
 */
export function counterpartIdsFor(
  extraction: Extraction,
  catalog: Drone[],
  targetId: string,
): string[] {
  const ids = new Set<string>();
  for (const s of extraction.systems ?? []) {
    const candidates = [s.matchId, s.variantOf, resolveSystemId(s.name, catalog)].filter(
      (v): v is string => !!v,
    );
    for (const id of candidates) {
      if (id !== targetId && catalog.some((d) => d.id === id)) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Symmetric counterpart links: links A -> B and B -> A, so the graph can be traversed from
 * either end. Returns only the drones whose `counterpartIds` actually changed, including the
 * target when it gained links. Self-links are dropped and existing links preserved.
 */
export function linkCounterparts(target: Drone, linkIds: string[], catalog: Drone[]): Drone[] {
  const changed: Drone[] = [];
  const add = (drone: Drone, ids: string[]) => {
    const before = drone.counterpartIds.length;
    const next = [...new Set([...drone.counterpartIds, ...ids])].filter((id) => id !== drone.id);
    if (next.length === before) return;
    changed.push({ ...drone, counterpartIds: next });
  };

  // Only link ids that actually exist, otherwise the graph accumulates dangling edges.
  const others = [
    ...new Set(linkIds.filter((id) => id !== target.id && catalog.some((d) => d.id === id))),
  ];
  add(target, others);
  for (const id of others) {
    const other = catalog.find((d) => d.id === id);
    if (other) add(other, [target.id]);
  }
  return changed;
}
