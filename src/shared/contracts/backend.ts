import type { DispatchCounts, ServerDocumentStore } from "@/shared/contracts/store";

/** Which server storage the process is configured for. `none` is a browser-only deployment. */
export type BackendKind = "postgres" | "cloud" | "none";

/**
 * What a backend can do, so callers branch on a capability instead of on a vendor name. A new
 * backend declares its capabilities here and no caller changes.
 */
export interface BackendCapabilities {
  /** `put` enforces the revision it was given (compare-and-swap) rather than last-write-wins. */
  revisions: boolean;
  /** Server-side jobs that need relational SQL: ledger, audit, rules, verification, source sync. */
  sql: boolean;
}

/**
 * The one place that knows which storage the server uses. Everything else asks this object and
 * never reads DATABASE_URL, SUPABASE_* or constructs a store itself.
 */
export interface StorageBackend {
  readonly kind: BackendKind;
  readonly capabilities: BackendCapabilities;
  /** Whether any server storage is configured (the browser then uses it instead of localStorage). */
  readonly serverStorage: boolean;
  /** The document store for this backend. */
  documents(): Promise<ServerDocumentStore>;
  /** Archive-wide dispatch counters, or null when the backend has no server storage. */
  archiveCounts(): Promise<DispatchCounts | null>;
}
