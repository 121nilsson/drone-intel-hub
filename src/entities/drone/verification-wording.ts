import { altitudeVerdict } from "./altitude-check";
import { speedVerdict } from "./speed-check";
import { targetVerdict } from "./target-check";
import { attributeSemantic } from "./spec-engine";
import type { SpecAttribute, SpecClaim, VerificationCheck } from "./types";
import { readsAsSentence, valueInQuote } from "./value-in-quote";
import { check } from "./verification-check";
import { evidencePassages, fold } from "./verification-evidence";

/**
 * A figure filed under an attribute about one target ("micro drone detection range") whose own
 * clause is about another ("vehicles at over 12 kilometers"). Read in the sentence that carries
 * the quote; silent when the attribute or the clause names no target (target-check.ts).
 */
export function targetCheck(
  spec: SpecAttribute,
  claim: SpecClaim,
  text: string | undefined,
  at: string,
): VerificationCheck {
  const quote = claim.evidence?.trim() || claim.raw?.trim() || "";
  const passage = (text && quote && evidencePassages(text, quote)[0]) || fold(quote);
  const v = targetVerdict(spec, String(claim.raw ?? claim.value), passage);
  if (!v.applicable) return check({ kind: "target", verdict: "uncertain", applicable: false, at });
  return check({
    kind: "target",
    verdict: v.verdict,
    applicable: true,
    confidence: v.verdict === "fail" ? 0.9 : 0.8,
    detail: v.detail,
    evidence: v.clause,
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    at,
  });
}

/**
 * The words beside the figure fit the attribute it is filed under: a height is not a distance
 * (altitude-check.ts), a cruise speed is not a top speed and the reverse (speed-check.ts). Read in
 * the sentence that carries the quote, like the target check; silent when the words say neither.
 */
export function wordsCheck(
  spec: SpecAttribute,
  claim: SpecClaim,
  text: string | undefined,
  at: string,
): VerificationCheck {
  const quote = claim.evidence?.trim() || claim.raw?.trim() || "";
  const passage = (text && quote && evidencePassages(text, quote)[0]) || fold(quote);
  const semantic = attributeSemantic(spec);
  const value = String(claim.raw ?? claim.value);
  const altitude = altitudeVerdict(semantic, value, passage);
  const v = altitude.applicable ? altitude : speedVerdict(semantic, value, passage);
  if (!v.applicable)
    return check({ kind: "attribute_words", verdict: "uncertain", applicable: false, at });
  return check({
    kind: "attribute_words",
    verdict: v.verdict,
    applicable: true,
    confidence: v.verdict === "fail" ? 0.9 : 0.8,
    detail: v.detail,
    evidence: v.clause,
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    at,
  });
}

/**
 * The quote says the value it is evidence for (value-in-quote.ts). Only a miss-or-match on the
 * quote: it never fails a claim, because a declined number word or a translated quote cannot be
 * matched deterministically; it keeps such a claim from reading as verified.
 */
export function valueCheck(claim: SpecClaim, at: string): VerificationCheck {
  const quote = claim.evidence?.trim();
  if (readsAsSentence(claim.value, claim.raw))
    return check({
      kind: "value_in_quote",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.2,
      detail:
        "the figure's reading is a whole sentence; a bound or another figure in it may be lost",
      ...(quote ? { evidence: quote } : {}),
      ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
      at,
    });
  const value = claim.raw?.trim() || String(claim.value ?? "").trim();
  const v = quote ? valueInQuote(value, quote) : ({ applicable: false } as const);
  // Without a quote of its own the claim's evidence is its raw value, which states itself.
  if (!v.applicable)
    return check({ kind: "value_in_quote", verdict: "uncertain", applicable: false, at });
  return check({
    kind: "value_in_quote",
    verdict: v.stated ? "pass" : "uncertain",
    applicable: true,
    confidence: v.stated ? 0.9 : 0.3,
    detail: v.detail,
    ...(quote ? { evidence: quote } : {}),
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    at,
  });
}
