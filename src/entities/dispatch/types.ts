/**
 * A raw post/article captured from a monitored source, stored before any AI work.
 * Collection (network) and processing (AI) are decoupled through this record.
 */
export type DispatchStatus = "pending" | "processed" | "irrelevant" | "failed";

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
}

export const MAX_ATTEMPTS = 3;
