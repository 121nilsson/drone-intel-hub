/**
 * A raw post/article captured from a monitored source, stored before any AI work.
 * Collection (network) and processing (AI) are decoupled through this record.
 */
export type DispatchStatus =
  | "pending"
  | "processed"
  | "irrelevant"
  | "failed"
  /**
   * A near-duplicate of a post already stored: text stripped, kept only so the archive still
   * shows that this source carried the same story. See entities/dispatch/simhash.ts.
   */
  | "duplicate";

export interface RawDispatch {
  /** `${sourceId}|${externalId}` — the dedupe key, stable across syncs. */
  id: string;
  sourceId: string;
  sourceName: string;
  externalId: string;
  url: string;
  /** Full original text. Emptied for irrelevant dispatches (only the stub is kept for dedupe). */
  text: string;
  publishedAt?: string | undefined;
  createdAt: string;
  status: DispatchStatus;
  processedAt?: string | undefined;
  error?: string | undefined;
  attempts?: number;
  /** Candidate ids and drone ids this dispatch produced — provenance for later cross-referencing. */
  candidateIds?: string[];
  droneIds?: string[];
  outcome?: "auto-merged" | "auto-promoted" | "auto-discarded" | "queued" | undefined;
  /**
   * SimHash fingerprint of `text`, written at collection time. Undefined on documents stored
   * before dedupe existed; those are fingerprinted lazily on read instead.
   */
  contentHash?: string | undefined;
  /** For `status: "duplicate"`: the canonical dispatch this post duplicates. */
  duplicateOf?: string | undefined;
  /** Versioned analysis identity for audit/reprocessing and cache decisions. */
  analysisFingerprint?: string;
  analysis?: {
    schemaVersion: number;
    engine: string;
    model?: string;
    promptVersion?: string;
    analyzedAt: string;
    escalationReasons?: string[];
  };
}

export const MAX_ATTEMPTS = 3;
