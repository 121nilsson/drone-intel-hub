import type { SpecClaim, VerificationCheck } from "./types";
import { check } from "./verification-check";

/** How evidence is compared with a post: NFKC, case and whitespace folded. One definition for every reader. */
export const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function evidenceCheck(
  claim: SpecClaim,
  text: string | undefined,
  at: string,
): VerificationCheck {
  const proof = claim.evidence?.trim() || claim.raw?.trim();
  if (!proof)
    return check({
      kind: "evidence_span",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.2,
      detail: "no quoted evidence to locate",
      at,
    });
  if (!text)
    return check({
      kind: "evidence_span",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.2,
      // Three different gaps, told apart so the exception list points at the right fix: a post
      // pruned from the archive, a reference page that was never a post, and a claim written
      // without a link to the post it came from.
      detail: claim.sourceId
        ? "source post is not in the archive"
        : claim.extractionEngine === "reference"
          ? "reference import: there is no post to check against"
          : "the claim records no source post",
      evidence: proof,
      ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
      at,
    });
  const found = fold(text).includes(fold(proof));
  return check({
    kind: "evidence_span",
    verdict: found ? "pass" : "fail",
    applicable: true,
    confidence: 1,
    detail: found
      ? "quoted evidence occurs in the source post"
      : "quoted evidence does not occur in the source post",
    evidence: proof,
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    at,
  });
}

/**
 * Sentences of a post, split before folding (folding turns line breaks into spaces). A stop ends
 * a sentence only when a capital or an opening quote follows, so "1.5 km" and "approx. 2,000 km"
 * stay whole; a split that still lands inside a sentence is covered by the window pass below.
 */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}«"“])|\n+/u)
    .map(fold)
    .filter(Boolean);

/** The longest run of consecutive sentences a quote is looked for in (a spec list over lines). */
const MAX_WINDOW = 4;

/** A passage of the post that carries the quote, and the folded sentence right before it. */
export interface PassageWithContext {
  passage: string;
  /** Absent when the passage opens the post. */
  before?: string;
}

/**
 * The passages of the post that carry the quote, found by containment on folded text - never by
 * character offsets, which folding shifts. A quote crossing a sentence or line boundary
 * ("...range of" / "2,000 km.") is looked for in the smallest run of consecutive sentences that
 * holds it. Empty when the quote is not in the post.
 */
export function evidencePassagesWithContext(text: string, quote: string): PassageWithContext[] {
  const needle = fold(quote);
  if (!needle) return [];
  const parts = sentences(text);
  for (let size = 1; size <= Math.min(MAX_WINDOW, parts.length); size++) {
    const found: PassageWithContext[] = [];
    for (let i = 0; i + size <= parts.length; i++) {
      const window = parts.slice(i, i + size).join(" ");
      if (window.includes(needle))
        found.push({ passage: window, ...(i > 0 ? { before: parts[i - 1] } : {}) });
    }
    if (found.length) return found;
  }
  return [];
}

export function evidencePassages(text: string, quote: string): string[] {
  return evidencePassagesWithContext(text, quote).map((p) => p.passage);
}
