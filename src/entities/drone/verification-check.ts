import type { VerificationCheck, VerificationKind, VerificationVerdict } from "./types";

/**
 * Bumping this re-verifies the whole catalogue on the next backfill. 2: identity anchored to the
 * evidence sentence with the extractor's strict matcher; sources counted per outlet. 3: claims
 * written without a post id are linked back to their post, and a missing post says why. 4: the
 * run moved to the server, which reads the whole archive; version 3 verdicts were written by the
 * browser over its newest 3,000 posts and called older posts "not in the archive". 5: names match
 * with real case endings only; "контракт" and "contrast" no longer name Contra. 6: a figure whose
 * clause names another target than its attribute ("vehicles at 12 km" as micro-drone range) fails.
 * 7: a claim whose quote does not state its value is uncertain, not verified (value-in-quote.ts).
 * 8: an altitude whose clause is a distance ("targets up to 2,000 km away") fails (altitude-check.ts).
 * 9: a figure whose reading is a whole sentence is uncertain (value-in-quote.ts readsAsSentence).
 * 10: a cruise speed whose words make it a top speed, or the reverse, fails (speed-check.ts).
 * 11: mm, cm and inches are units; a bare figure takes its attribute's unit; units compare by dimension.
 * 12: a count has no unit; "Number of missiles" was checked as a mass in kg and passed.
 * 13: bounds follow the entry's flight profile (a ballistic missile), and 161 stored claims got a
 * reading, so their unit and bounds checks can now run.
 * 14: an "It ..." evidence sentence is identified by the sentence before it, so a figure that
 * follows a sentence naming the system is no longer uncertain for want of a name.
 */
export const VERIFIER_VERSION = "deterministic-14";

interface CheckInput {
  kind: VerificationKind;
  verdict: VerificationVerdict;
  applicable: boolean;
  detail?: string;
  confidence?: number;
  evidence?: string;
  sourceId?: string;
  at: string;
}

export const check = ({
  kind,
  verdict,
  applicable,
  detail,
  confidence,
  evidence,
  sourceId,
  at,
}: CheckInput): VerificationCheck => ({
  id: kind,
  kind,
  verdict,
  applicable,
  ...(confidence !== undefined ? { confidence } : {}),
  ...(detail ? { detail } : {}),
  ...(evidence ? { evidence: evidence.slice(0, 500) } : {}),
  ...(sourceId ? { sourceId } : {}),
  verifierVersion: VERIFIER_VERSION,
  at,
});
