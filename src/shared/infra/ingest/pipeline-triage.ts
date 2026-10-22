import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import { outletKey } from "@/entities/source/outlet-record";
import { collisionKey } from "./pipeline-internal";

/**
 * Words that name an organisation, a unit or an outlet rather than a piece of equipment. A model
 * that misreads a report ("operators of the unmanned systems battalion destroyed a convoy") is
 * often confident about it, so confidence alone cannot keep these out of the catalog.
 */
export const ORGANISATION =
  /\b(?:brigades?|battalions?|regiments?|divisions?|corps|command|forces|army|navy|air force|guards?|troops|grouping|agency|news|ministry|department|directorate|company|corporation|inc|ltd|llc|gmbh|jsc|holding|institute|university|bureau|paratroopers)\b|бригад|батальйон|батальон|полк|дивізі|дивизи|корпус|командуван|командован|угруповання|группировк|агентств|міністерств|министерств/iu;

/**
 * True when a name should not be promoted into the catalog without an analyst: it reads as an
 * organisation, or it is the outlet the report came from ("Ukrinform" from "Ukrinform (War)").
 * Only auto-promotion is gated; the candidate still goes to the Queue for review.
 */
export function notASystemName(name: string, source: string): boolean {
  if (ORGANISATION.test(name)) return true;
  const key = collisionKey(name);
  const outlet = collisionKey(source.split(" · ")[0]!.replace(/\(.*?\)/g, ""));
  // Short keys would match by accident ("UA" inside "Ukrainska Pravda").
  if (key.length < 4 || outlet.length < 4) return false;
  return outlet.includes(key) || key.includes(outlet);
}

/** True when any of the extraction's names is already a catalog name or alias. */
export function collidesWithCatalog(e: Extraction, catalog: Drone[]): boolean {
  const known = new Set<string>();
  for (const d of catalog) {
    if (d.name) known.add(collisionKey(d.name));
    if (d.cyrillic) known.add(collisionKey(d.cyrillic));
    for (const a of d.aliases) known.add(collisionKey(a));
  }
  return [e.name ?? "", ...e.aliases].some((n) => n.trim() && known.has(collisionKey(n)));
}

/**
 * Names the system has learned not to promote automatically. Two paths in:
 *
 * - an analyst discarded the name once — their word is final, as it has always been;
 * - the pipeline discarded it itself from LEARNED_NEGATIVE_REPEATS different outlets, which is a
 *   false-positive pattern repeating, not three coincidences.
 *
 * Only automatic paths consult this; the Queue page can still promote any name by hand.
 */
export const LEARNED_NEGATIVE_REPEATS = 3;

export function learnedNegativeKeys(candidates: readonly Candidate[]): Set<string> {
  const suppressed = new Set<string>();
  const autoDiscards = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (c.status !== "discarded") continue;
    const name = c.extraction.name;
    if (!name) continue;
    const key = collisionKey(name);
    if (!key) continue;
    if (c.resolvedBy === "analyst") {
      suppressed.add(key);
      continue;
    }
    const outlets = autoDiscards.get(key) ?? new Set<string>();
    outlets.add(outletKey(c.source));
    autoDiscards.set(key, outlets);
  }
  for (const [key, outlets] of autoDiscards)
    if (outlets.size >= LEARNED_NEGATIVE_REPEATS) suppressed.add(key);
  return suppressed;
}
