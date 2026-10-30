import type { Candidate } from "./types";

/**
 * When a candidate only repeats a later one. Every analysis of a post writes one candidate per
 * system it names, and a re-analysis writes a new set rather than replacing the old one: 12,947
 * stored candidates held 3,269 posts, 5,665 of them a second-or-later reading of the same system
 * in the same post. The later reading is the one the catalog now reflects - re-analysis retracts
 * the earlier run's contribution before it reads the post again - so the earlier candidate
 * records nothing anyone can still act on.
 */

/** The post: the same text from the same outlet. Two outlets posting it are two reports. */
export const postKey = (c: Pick<Candidate, "source" | "raw">) =>
  `${c.source}|${(c.raw ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;

/** The system the candidate is about within its post. */
export const systemKey = (c: Pick<Candidate, "extraction">) =>
  (c.extraction?.matchId ?? c.extraction?.name ?? "").trim().toLowerCase();

/**
 * A candidate that must stay whatever repeats it: an analyst's decision (the ground truth the
 * evaluation is scored on), one that created a catalog entry (the entry names it as its source),
 * and one its post still lists as the current reading.
 */
export function keepsItsPlace(c: Candidate, current: ReadonlySet<string>): boolean {
  return c.resolvedBy === "analyst" || c.status === "promoted" || current.has(c.id);
}

/** The candidates a later reading of the same post and system has replaced. */
export function repeatedCandidates(
  candidates: readonly Candidate[],
  current: ReadonlySet<string> = new Set(),
): Candidate[] {
  const latest = new Map<string, Candidate>();
  const key = (c: Candidate) => `${postKey(c)}|${systemKey(c)}`;
  for (const c of candidates) {
    const prev = latest.get(key(c));
    if (!prev || (c.createdAt ?? "") > (prev.createdAt ?? "")) latest.set(key(c), c);
  }
  return candidates.filter((c) => latest.get(key(c)) !== c && !keepsItsPlace(c, current));
}
