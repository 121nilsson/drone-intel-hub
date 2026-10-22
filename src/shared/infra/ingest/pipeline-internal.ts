import type { Drone, Extraction, SystemExtraction } from "@/entities/drone/types";
import { phoneticKey, phoneticText } from "@/entities/drone/name-key";
import { linkVariant } from "@/entities/drone/merge-intelligence";
import { mergeLinks, normalizeExtraction, toRFLink } from "@/entities/normalization/apply";

/** Collision keys strip punctuation and spacing, not just case: to a source document
 * "Shahed-136" and "Shahed 136" are the same system, and auto-promotion must not create a
 * duplicate catalog entry just because the source hyphenated differently than the catalog did.
 * The same goes for script and romanisation: "Ланцет-3" collides with "Lancet-3". */
export const collisionKey = (s: string) => phoneticKey(s);

/** Mark an extraction with why it came from a degraded tier, visible to the analyst in triage. */
export function annotate(extraction: Extraction, note: string): Extraction {
  return extraction.rationale
    ? { ...extraction, rationale: `${extraction.rationale} · ${note}` }
    : { ...extraction, rationale: note };
}

/** A parser bug must not burn a dispatch attempt. The raw extraction is kept when normalization throws. */
export function applyNormalization(extraction: Extraction): ReturnType<typeof normalizeExtraction> {
  try {
    return normalizeExtraction(extraction);
  } catch (err) {
    console.error("[normalize]", err);
    return { extraction, unknowns: [] };
  }
}

export function withNormalizedRf(drone: Drone, extraction: Extraction): Drone {
  const links = (extraction.rf ?? []).map(toRFLink);
  if (!links.length) return drone;
  return { ...drone, rf: mergeLinks(drone.rf, links) };
}

/** Gain counterpart links on an already-stored copy, preserving whatever else it now carries. */
export function withCounterparts(doc: Drone, ids: readonly string[]): Drone {
  const next = [...new Set([...doc.counterpartIds, ...ids])].filter((id) => id !== doc.id);
  if (next.length === doc.counterpartIds.length) return doc;
  return { ...doc, counterpartIds: next };
}

/**
 * Reapply one side of a variant link after a conflict. The other side is re-read from the
 * repository, so a concurrent enrichment of either entry is not replaced by a stale copy.
 */
export function linkVariantReplay(
  fresh: Drone,
  parentId: string,
  childId: string,
  drones: { get: (id: string) => Drone | undefined },
): Drone {
  if (fresh.id === parentId) {
    const child = drones.get(childId);
    return child ? linkVariant(fresh, child)[0] : fresh;
  }
  const parent = drones.get(parentId);
  return parent ? linkVariant(parent, fresh)[1] : fresh;
}

export function stemAndNumber(name: string): { stem: string; number: string } {
  const key = phoneticText(name).replace(/\s+/g, "");
  const match = key.match(/^(.*?)(\d+)$/);
  if (!match) return { stem: key.replace(/[aeiou]+$/, ""), number: "" };
  const [, stem, number] = match as [string, string, string];
  return { stem: stem.replace(/[aeiou]+$/, ""), number };
}

export function phoneticNameMatches(left: string, right: string): boolean {
  const a = stemAndNumber(left);
  const b = stemAndNumber(right);
  if (a.number !== b.number) return false;
  if (!a.number && !b.number) return a.stem === b.stem;
  return a.stem === b.stem;
}

export function findExistingSystemByIdentity(
  extraction: Extraction,
  catalog: Drone[],
): string | undefined {
  const candidate = extraction.name?.trim();
  if (!candidate) return undefined;
  const ids = new Set<string>();
  for (const drone of catalog) {
    for (const spelling of [drone.name, drone.cyrillic]) {
      if (spelling && phoneticNameMatches(candidate, spelling)) ids.add(drone.id);
    }
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}
