import type { StoredEntailmentVerdict } from "@/entities/drone/types";

/**
 * Storage the server-side verification jobs (deterministic run, second reader, verifier controls)
 * use. Split into roles so each caller depends only on the operations it uses; the adapters
 * (shared/infra/postgres, shared/infra/null-repos) compose them into VerificationRepo.
 *
 * Nothing here exposes a SQL client or a SQL string: an operation is a thing the domain asks for.
 */

/** One post as the deterministic run reads it from the archive. */
export interface VerificationPostRow {
  id: string;
  sourceName: string | null;
  url: string | null;
  text: string;
  contentHash: string | null;
}

/** A post's text with the time it was stored, for choosing the newest first. */
export interface PostTextRow {
  id: string;
  text: string | null;
  created_at: Date;
}

/** Reads of the archive's posts. */
export interface VerificationPosts {
  /**
   * The posts the pending claims can be checked against: by id, or by the URL they carry; a post
   * whose text was emptied is returned only by its own id and only while it has a content hash.
   */
  postsForVerification(
    ids: readonly string[],
    urls: readonly string[],
  ): Promise<VerificationPostRow[]>;
  /** The text and storage time of the posts with these ids. */
  postTexts(ids: readonly string[]): Promise<PostTextRow[]>;
}

/** One control the second reader answered (migrations/025). */
export interface ControlRecord {
  claimId: string;
  droneId: string;
  specKey: string;
  family: string | null;
  language: string | null;
  sourceId: string;
  trueValue: string;
  alteredValue: string;
  verdict: StoredEntailmentVerdict;
  span: string | null;
  provider: string;
  model: string;
  entailmentVersion: string;
}

/** What a stored control contributes to the controls' record. */
export interface ControlVerdictRow {
  verdict: StoredEntailmentVerdict;
  family: string | null;
  language: string | null;
}

/** The record of verifier controls: measured, never written to the catalogue. */
export interface VerifierControlRecords {
  /** Claims that already have a control for this entailment version. */
  askedClaimIds(entailmentVersion: string): Promise<string[]>;
  /** Store one answered control; a claim has at most one per entailment version. */
  recordControl(control: ControlRecord): Promise<void>;
  /** The verdicts stored for this entailment version, with their strata. */
  controlVerdicts(entailmentVersion: string): Promise<ControlVerdictRow[]>;
}

/** Tokens spent on the AI verifier today, per purpose. */
export interface VerifierTokenLedger {
  /** Input and output tokens spent today on any of `purposes`. */
  usedToday(purposes: readonly string[]): Promise<{ input: number; output: number }>;
  /** Add one call's tokens to today's total for `purpose`. */
  recordUsage(purpose: string, used: { input: number; output: number }): Promise<void>;
}

export type VerificationRepo = VerificationPosts & VerifierControlRecords & VerifierTokenLedger;
