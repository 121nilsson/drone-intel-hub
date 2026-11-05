export interface CollectReport {
  source: string;
  fetched: number;
  stored: number;
  /** Posts suppressed as near-duplicates of something already stored. */
  duplicates: number;
  /** Wall-clock for this source, so a slow host is visible in the activity log. */
  durationMs: number;
  error?: string;
}
export interface ProcessReport {
  processed: number;
  irrelevant: number;
  merged: number;
  /** New systems auto-promoted into the catalog. */
  promoted: number;
  /** Low-confidence candidates auto-discarded. */
  discarded: number;
  queued: number;
  failed: number;
  remaining: number;
  /** Documents leased exclusively by this run - 0 when another worker holds them all. */ leased: number;
  /** Why this batch stopped, when a provider or pipeline error aborted the rest. */
  stopReason?: string;
  heuristicOnly?: number;
  tier1Calls?: number;
  tier2Calls?: number;
  parseFailures?: number;
}

/** Combined report kept for the server job's stored result. */
export interface SyncReport {
  source: string;
  fetched: number;
  relevant: number;
  merged: number;
  queued: number;
  /** Posts suppressed as near-duplicates. Only source rows carry it; see collectSource. */
  duplicates?: number;
  /** Wall-clock for this source. Only source rows carry it. */
  durationMs?: number;
  error?: string;
}
