/** Single global throttle slot for the auto-ingest job. */
export const SYNC_SLOT = "sources:auto";
export const SYNC_PROGRESS_SLOT = "sources:progress";
export const SYNC_COOLDOWN_SLOT = "sources:cooldown";

/** One `sync_state` row: a named slot with the time it was last written and its JSON payload. */
export interface SyncSlotRow {
  name: string;
  lastSync: Date | null;
  /** The stored JSON, or a string a driver left undecoded; callers parse it defensively. */
  lastResult: unknown;
}

/**
 * Port for the `sync_state` slots (migrations/002). Methods throw on a storage failure; callers
 * decide whether that is fatal.
 */
export interface SyncStateRepo {
  /**
   * The rows of the named slots that exist, or null when the backend has no database (the caller
   * then reports sync state as unavailable, which is different from "configured, nothing stored").
   */
  readSlots(names: readonly string[]): Promise<SyncSlotRow[] | null>;
}
