/**
 * Port for the auto-ingest throttle and heartbeat slots in `sync_state` (migrations/002). The
 * payloads are opaque JSON documents here; their shapes and parsers belong to the sync module.
 * Methods throw on a storage failure; the sync decides which failures are fatal.
 */
export interface SourceSyncRepo {
  /**
   * Claim the throttle slot. A compare-and-swap: overlapping cron ticks or a manual click cannot
   * both win. Returns false when the minimum interval has not elapsed. `force` drops the interval
   * check but still stamps the start of the run.
   */
  claimSlot(minIntervalMs: number, force: boolean): Promise<boolean>;
  /** Release the throttle slot so a transient failure does not lock out the next tick. */
  releaseSlot(): Promise<void>;
  /** Store the reports of the pass that holds the slot. */
  storeResult(result: unknown): Promise<void>;
  /** The stored cooldown document, or undefined when none is stored. */
  readCooldown(): Promise<unknown>;
  writeCooldown(cooldown: unknown): Promise<void>;
  clearCooldown(): Promise<void>;
  /** Publish the run's progress heartbeat. */
  writeProgress(progress: unknown): Promise<void>;
}
