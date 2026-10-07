import type { Candidate, Drone } from "@/entities/drone/types";
import type { MonitoredSource } from "@/entities/source/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Procurement } from "@/entities/procurement/types";

export type Collection = "drones" | "candidates" | "sources" | "dispatches" | "procurements";

export interface CollectionMap {
  drones: Drone;
  candidates: Candidate;
  sources: MonitoredSource;
  dispatches: RawDispatch;
  procurements: Procurement;
}

export interface Snapshot {
  drones: Drone[];
  candidates: Candidate[];
  sources: MonitoredSource[];
  dispatches: RawDispatch[];
  procurements: Procurement[];
}

/**
 * Async document persistence — the only seam between repositories and storage.
 * Implementations: browser localStorage, remote server-function bridge, PostgreSQL.
 */
export interface DocumentStore {
  /** Returns null when the collection has never been initialised. */
  load<C extends Collection>(c: C): Promise<CollectionMap[C][] | null>;
  /** Initialise an empty collection with seed data. */
  seed<C extends Collection>(c: C, items: CollectionMap[C][]): Promise<void>;
  put<C extends Collection>(c: C, doc: CollectionMap[C]): Promise<void>;
  remove(c: Collection, id: string): Promise<void>;
  /**
   * Atomically lease up to `limit` pending documents, oldest first, and return exactly those.
   * Anything not leased is left untouched.
   *
   * Exists because read-then-write cannot be made exclusive: two workers (the browser's
   * "Analyse queue" and the cron task) both read the same pending set before either writes,
   * so both would process the same document and produce duplicate candidates. Only storage
   * can serialise the claim. Documents leased by another worker are skipped unless the lease
   * has expired, which is what lets a crashed worker's documents become claimable again with
   * no cleanup job.
   *
   * Return null when the store cannot lease at all (missing migration, unsupported backend),
   * so the caller can fall back to plain reads. An empty array means "claimed nothing",
   * which is a real result and must not be confused with the fallback.
   */
  claim?(
    c: Collection,
    opts: { limit: number; leaseMs: number; owner: string },
  ): Promise<string[] | null>;
  /** Clear leases held by `owner` - called on completion, failure, and startup recovery. */
  release?(c: Collection, ids: string[], owner: string): Promise<void>;
}
