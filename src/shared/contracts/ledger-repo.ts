import type { AutonomyEvent } from "@/shared/contracts/verification";

/** One ledger row as the domain hands it over: already trimmed to the column limits. */
export interface LedgerRecord {
  action: string;
  actor: string;
  actorKind: string;
  targetCollection: string;
  targetId: string;
  category: string | null;
  verdict: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  checks: unknown;
  confidence: number | null;
  reversible: boolean;
  correlationId: string | null;
}

/**
 * Port for the autonomy ledger (migrations/018). Methods throw on a storage failure; the ledger's
 * best-effort policy (log and drop) lives in the caller, not here.
 */
export interface LedgerRepo {
  /** Append one event. */
  append(record: LedgerRecord): Promise<void>;
  /**
   * Keep the newest `keep` rows among the given heartbeat kinds. A row another event points back
   * at (`reversed_by`) is never removed, and rows of other kinds are never touched.
   */
  pruneHeartbeats(kinds: readonly string[], keep: number): Promise<void>;
  /** The newest events, newest first. `limit` is already clamped by the caller. */
  recent(limit: number): Promise<AutonomyEvent[]>;
}
