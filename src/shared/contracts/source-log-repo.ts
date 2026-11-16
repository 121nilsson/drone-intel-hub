/** One fetch of one source, already trimmed to the column limits. */
export interface SourceFetchRecord {
  sourceId: string;
  ok: boolean;
  fetched: number;
  duplicates: number;
  error: string | null;
}

/** Per-source counts over a window. */
export interface SourceFetchTotals {
  sourceId: string;
  fetches: number;
  failures: number;
  fetched: number;
  relevant: number;
  lastOkAt: Date | null;
}

/** One logged fetch, as read back for the drift check. */
export interface SourceFetchHistoryRow {
  sourceId: string;
  at: Date;
  ok: boolean;
  fetched: number;
  relevant: number;
  error: string | null;
}

/**
 * Port for the per-source fetch history (`source_fetch_log`). Methods throw on a storage failure;
 * the log is best effort, so callers log and drop.
 */
export interface SourceLogRepo {
  append(entry: SourceFetchRecord): Promise<void>;
  /** Drop history older than `days` days. */
  prune(days: number): Promise<void>;
  /** Totals per source over the last `days`. */
  totals(days: number): Promise<SourceFetchTotals[]>;
  /** The newest `perSource` fetches of each source over the last `days`, newest first per source. */
  history(days: number, perSource: number): Promise<SourceFetchHistoryRow[]>;
}
