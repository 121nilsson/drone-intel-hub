import type { Drone, DroneReference, ReferenceCard } from "@/entities/drone/types";
import { isQid, referenceKey } from "@/shared/infra/wikipedia";

export interface ApplyReferenceReport {
  created: number;
  enriched: number;
  linked: number;
  skipped: number;
  /** Drones the caller should upsert. Unchanged cards are absent. */
  changed: Drone[];
}

/**
 * Fills identity from reference cards. An existing summary, operator list, spec, RF link,
 * component, or propulsion value is left as it is. Two Wikidata items that name one catalog
 * card share that card: the second id is stored on `alsoIds` and the card is not duplicated.
 */
export function applyReference(
  catalog: readonly Drone[],
  cards: readonly ReferenceCard[],
  now = new Date().toISOString(),
): ApplyReferenceReport {
  const working = catalog.map((d) => d);
  const changed = new Map<string, Drone>();
  const report = { created: 0, enriched: 0, linked: 0, skipped: 0, changed: [] as Drone[] };

  for (const card of cards) {
    if (!isQid(card.wikidataId) || !card.name.trim()) {
      report.skipped++;
      continue;
    }
    const hit = find(working, card);
    if (!hit) {
      const drone = createDrone(card, freshId(card, working), now);
      working.push(drone);
      changed.set(drone.id, drone);
      report.created++;
      continue;
    }
    const mode = attachMode(hit.drone, card);
    const next = applyOne(hit.drone, card, now, mode);
    if (sameIdentity(hit.drone, next)) {
      report.skipped++;
      continue;
    }
    working[hit.index] = next;
    changed.set(next.id, next);
    const already =
      hit.drone.reference?.wikidataId === card.wikidataId ||
      hit.drone.reference?.alsoIds.includes(card.wikidataId);
    if (mode === "also" && !already) report.linked++;
    else report.enriched++;
  }

  report.changed = [...changed.values()];
  return report;
}

function referenceKeys(values: string[]): Set<string> {
  const keys = new Set<string>();
  for (const value of values) {
    const key = referenceKey(value);
    if (key) keys.add(key);
  }
  return keys;
}

function find(catalog: Drone[], card: ReferenceCard): { index: number; drone: Drone } | null {
  const byId = catalog.findIndex(
    (d) =>
      d.reference?.wikidataId === card.wikidataId || d.reference?.alsoIds.includes(card.wikidataId),
  );
  if (byId >= 0) return { index: byId, drone: catalog[byId]! };
  const labelKey = referenceKey(card.name);
  const keys = referenceKeys([card.name, card.cyrillic ?? "", ...card.aliases]);
  if (keys.size === 0) return null;
  // The canonical label may match an existing alias ("Shahed 136" / "Shahed-136").
  // Incoming aliases may match an existing name or Cyrillic form ("Geran-2" on the
  // Shahed-136 item). Alias-to-alias overlap stays unmatched, so a shared "Shahed"
  // alias does not pull Shahed-238 onto Geran-2.
  const byLabel = catalog.findIndex((d) => {
    if (keys.has(referenceKey(d.name))) return true;
    if (d.cyrillic && keys.has(referenceKey(d.cyrillic))) return true;
    return labelKey !== "" && d.aliases.some((alias) => referenceKey(alias) === labelKey);
  });
  if (byLabel >= 0) return { index: byLabel, drone: catalog[byLabel]! };
  return null;
}

/** The first id to reach a card becomes its primary. A later id for the same card is an alias id. */
function attachMode(drone: Drone, card: ReferenceCard): "primary" | "also" {
  if (!drone.reference?.wikidataId || drone.reference.wikidataId === card.wikidataId)
    return "primary";
  return "also";
}

function applyOne(drone: Drone, card: ReferenceCard, now: string, mode: "primary" | "also"): Drone {
  const cyrillic = drone.cyrillic || card.cyrillic || undefined;
  const manufacturer = drone.manufacturer || card.manufacturer;
  const origin = drone.origin && drone.origin !== "??" ? drone.origin : card.origin || drone.origin;
  const operators = drone.operators.length > 0 ? drone.operators : card.operators;
  return {
    ...drone,
    aliases: unionAliases(drone.name, cyrillic, drone.aliases, [
      card.name,
      card.cyrillic ?? "",
      ...card.aliases,
    ]),
    summary: drone.summary.trim() ? drone.summary : card.summary || drone.summary,
    origin,
    operators,
    ...(cyrillic ? { cyrillic } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    reference: nextReference(drone.reference, card, now, mode),
    updatedAt: now,
  };
}

function nextReference(
  prev: DroneReference | undefined,
  card: ReferenceCard,
  now: string,
  mode: "primary" | "also",
): DroneReference {
  if (mode === "also" && prev) {
    const alsoIds = prev.alsoIds.includes(card.wikidataId)
      ? prev.alsoIds
      : [...prev.alsoIds, card.wikidataId];
    return { ...prev, alsoIds };
  }
  return {
    wikidataId: card.wikidataId,
    alsoIds: (prev?.alsoIds ?? []).filter((id) => id !== card.wikidataId),
    lang: card.lang,
    title: card.title,
    revisionId: card.revisionId,
    url: card.url,
    license: "CC BY-SA 4.0",
    importedAt:
      prev?.revisionId === card.revisionId && prev.wikidataId === card.wikidataId
        ? prev.importedAt
        : now,
  };
}

function unionAliases(
  name: string,
  cyrillic: string | undefined,
  existing: string[],
  incoming: string[],
): string[] {
  const skip = new Set(
    [referenceKey(name), cyrillic ? referenceKey(cyrillic) : ""].filter(Boolean),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...existing, ...incoming]) {
    const text = raw.trim();
    const key = referenceKey(text);
    if (!key || skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function sameIdentity(prev: Drone, next: Drone): boolean {
  const a = prev.reference;
  const b = next.reference;
  const refSame =
    !!a &&
    !!b &&
    a.wikidataId === b.wikidataId &&
    a.alsoIds.join("\0") === b.alsoIds.join("\0") &&
    a.lang === b.lang &&
    a.title === b.title &&
    a.revisionId === b.revisionId &&
    a.url === b.url &&
    a.license === b.license;
  return (
    refSame &&
    prev.summary === next.summary &&
    (prev.cyrillic ?? "") === (next.cyrillic ?? "") &&
    (prev.manufacturer ?? "") === (next.manufacturer ?? "") &&
    prev.origin === next.origin &&
    prev.operators.join("\0") === next.operators.join("\0") &&
    prev.aliases.join("\0") === next.aliases.join("\0")
  );
}

function createDrone(card: ReferenceCard, id: string, now: string): Drone {
  const cyrillic = card.cyrillic;
  return {
    id,
    name: card.name,
    ...(cyrillic ? { cyrillic } : {}),
    aliases: unionAliases(card.name, cyrillic, [], card.aliases),
    domain: card.domain,
    origin: card.origin || "??",
    ...(card.manufacturer ? { manufacturer: card.manufacturer } : {}),
    operators: card.operators,
    propulsion: "Unknown",
    summary: card.summary,
    specs: [],
    rf: [],
    components: [],
    evolution: [
      {
        date: now,
        kind: "other",
        description: card.url.includes("wikipedia.org")
          ? `Imported from Wikipedia (${card.title})`
          : `Imported from Wikidata (${card.wikidataId})`,
        source: card.url,
      },
    ],
    counterpartIds: [],
    reference: {
      wikidataId: card.wikidataId,
      alsoIds: [],
      lang: card.lang,
      title: card.title,
      revisionId: card.revisionId,
      url: card.url,
      license: "CC BY-SA 4.0",
      importedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function freshId(card: ReferenceCard, catalog: readonly Drone[]): string {
  const base = card.name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = base || card.wikidataId.toLowerCase();
  const taken = new Set(catalog.map((d) => d.id));
  if (!taken.has(stem)) return stem;
  const suffixed = `${stem}-${card.wikidataId.toLowerCase()}`;
  if (!taken.has(suffixed)) return suffixed;
  let n = 2;
  while (taken.has(`${suffixed}-${n}`)) n++;
  return `${suffixed}-${n}`;
}
