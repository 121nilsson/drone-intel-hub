import type { VerifierControlsStatus } from "./verification";

/**
 * Per-source fetch health over the last N days, as the sources page and the Autonomy page read it.
 * Lives in the contract so a feature can name it without importing the server module that
 * computes it (shared/infra/sources/fetch-log.server.ts).
 */
export interface SourceFetchHealth {
  sourceId: string;
  fetches: number;
  failures: number;
  fetched: number;
  relevant: number;
  lastOkAt?: string | undefined;
  lastError?: string | undefined;
  drift?: "quiet" | "failing" | undefined;
}

/**
 * What the Autonomy page reads about the autonomous machinery: the second reader's record on the
 * injected controls, and how each source has been fetched. Read-only; nothing here changes data.
 * Where the storage has no server database both answers are empty, not an error.
 */
export interface AutonomyInsights {
  controls(): Promise<VerifierControlsStatus>;
  sourceHealth(days?: number): Promise<SourceFetchHealth[]>;
}
