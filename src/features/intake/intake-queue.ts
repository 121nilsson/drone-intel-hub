import { normalizeForHash } from "@/entities/dispatch/simhash";
import type { Candidate } from "@/entities/drone/types";

/**
 * Identity of the report a candidate came from. An archived post has a stable id; a pasted report
 * is identified by its whole normalised text. The old 240-character prefix grouped unrelated
 * reports that happened to open the same way, so no prefix is used here.
 */
export function reportKey(c: Candidate): string {
  if (c.dispatchId) return `dispatch:${c.dispatchId}`;
  const text = normalizeForHash(c.raw);
  // Text with no words to identify it must not join every other such report.
  return text ? `text:${text}` : `candidate:${c.id}`;
}

/**
 * Pending candidates that came from one report and still have an unresolved variant relation.
 * Several such candidates are often slices of a single multi-system extraction.
 */
export function groupUnresolvedFamilies(pending: readonly Candidate[]): Candidate[][] {
  const families = new Map<string, Candidate[]>();
  for (const c of pending) {
    const hasUnresolvedRelation = (c.extraction.systems ?? []).some(
      (s) => !s.matchId && Boolean(s.variantOf),
    );
    const isMultiSystem = (c.extraction.systems?.length ?? 0) > 1;
    if (!hasUnresolvedRelation && !isMultiSystem) continue;
    const key = reportKey(c);
    const group = families.get(key) ?? [];
    group.push(c);
    families.set(key, group);
  }
  return [...families.values()];
}

/**
 * One page of the queue: a family counts as one item, families come first and single candidates
 * fill the rest. Without this split each list revealed a full page, so "Show 20 more" could reveal
 * up to 40 items.
 */
export function pageQueue<T>(families: readonly T[][], singles: readonly T[], visible: number) {
  const shownFamilies = families.slice(0, visible);
  const shownSingles = singles.slice(0, Math.max(0, visible - shownFamilies.length));
  const shownCount = shownFamilies.length + shownSingles.length;
  return {
    families: shownFamilies,
    singles: shownSingles,
    shownCount,
    hiddenRemaining: families.length + singles.length - shownCount,
  };
}
