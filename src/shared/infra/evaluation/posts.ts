import { postKey, systemKey } from "@/entities/drone/candidate-repeats";
import type { Candidate, Extraction } from "@/entities/drone/types";
import type { Norm } from "./compare";
import { verifiedReference, type ReferenceVerdicts } from "./reference";

/**
 * Candidates grouped into posts. The heuristic reads a whole post, so each post is scored once
 * against everything the AI read in it, not once per system or per re-analysis.
 */

/** A post as the evaluation reads it: the heuristic's unit is the whole text. */
export interface EvalPost {
  /** Stands for the post in stratification, mismatches and fixtures. */
  post: Candidate;
  /** One candidate per system the AI read in the post, its latest analysis (or the analyst's). */
  systems: Candidate[];
}

/**
 * Candidates grouped into posts. A post naming five systems is five candidates, and a post
 * analysed again is a new set with the same text - 12,947 candidates held 3,269 posts. Scoring
 * each candidate counted a figure the heuristic read from the post once per system and once per
 * re-analysis: one "12 antennas" became forty false positives, and its own corroboration. The
 * heuristic reads the whole post, so it is scored once against everything the AI read in it.
 */
export function evalPosts(candidates: readonly Candidate[]): EvalPost[] {
  const rank = (c: Candidate) => `${c.resolvedBy === "analyst" ? 1 : 0}|${c.createdAt ?? ""}`;
  const posts = new Map<string, Map<string, Candidate>>();
  for (const c of candidates) {
    const key = postKey(c);
    const systems = posts.get(key) ?? new Map<string, Candidate>();
    const prev = systems.get(systemKey(c));
    if (!prev || rank(c) > rank(prev)) systems.set(systemKey(c), c);
    posts.set(key, systems);
  }
  return [...posts.values()].map((m) => {
    const systems = [...m.values()];
    // The analyst's call if there is one, else the run's first candidate - its primary.
    const post =
      systems.find((c) => c.resolvedBy === "analyst") ??
      [...systems].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0]!;
    return { post, systems };
  });
}

/**
 * When two systems in one report carry the same figure, the strongest knowledge of it wins: an
 * analyst verdict, then a verifier verdict, then the unverified stored reading, and last the
 * claim the verifier could not decide.
 */
const referenceRank = (n: Norm): number =>
  n.verdict === "confirmed"
    ? 5
    : n.verdict === "rejected"
      ? 4
      : n.verification === "verified"
        ? 3
        : n.verification === "rejected"
          ? 2
          : n.verification === "uncertain"
            ? 0
            : 1;

/** Everything the catalogue read in the post, each figure once, with its verification state. */
export function postReferences(p: EvalPost, verdicts: ReferenceVerdicts): Norm[] {
  const byKey = new Map<string, Norm>();
  for (const c of p.systems)
    for (const n of verifiedReference(c, verdicts)) {
      const k = `${n.semantic}|${n.canonical ?? n.value}|${n.canonicalUnit ?? n.unit ?? ""}`;
      const prev = byKey.get(k);
      if (!prev || referenceRank(n) > referenceRank(prev)) byKey.set(k, n);
    }
  return [...byKey.values()];
}

export const postExtraction = (p: EvalPost): Extraction => ({
  ...p.post.extraction,
  systems: p.systems.flatMap((c) => c.extraction.systems ?? []),
});
