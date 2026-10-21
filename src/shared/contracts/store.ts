import type { Candidate, Drone } from "@/entities/drone/types";
import type { MonitoredSource } from "@/entities/source/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Procurement } from "@/entities/procurement/types";

import type { StoredTaxonomyTerm, TaxonomyCandidate } from "@/entities/normalization/taxonomy";

/** One list so a new collection fails the build until every store handles it. */
export const COLLECTIONS = [
  "drones",
  "candidates",
  "sources",
  "dispatches",
  "procurements",
  "taxonomies",
  "taxonomy_candidates",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

export interface CollectionMap {
  drones: Drone;
  candidates: Candidate;
  sources: MonitoredSource;
  dispatches: RawDispatch;
  procurements: Procurement;
  taxonomies: StoredTaxonomyTerm;
  taxonomy_candidates: TaxonomyCandidate;
}

export interface Snapshot {
  drones: Drone[];
  candidates: Candidate[];
  sources: MonitoredSource[];
  dispatches: RawDispatch[];
  procurements: Procurement[];
  taxonomies: StoredTaxonomyTerm[];
  taxonomy_candidates: TaxonomyCandidate[];
}

/** A document together with the revision of the stored copy it was read from. */
export interface VersionedDoc<T> {
  doc: T;
  /** Monotonic per-document revision. 0 means the stored copy has never been updated. */
  rev: number;
}

/**
 * Thrown by `DocumentStore.put` when the stored revision no longer matches `expectedRev`.
 *
 * The caller read a copy that another writer has since replaced. Its write was not applied, and
 * it must reload and reapply the change rather than overwrite the other writer's document.
 */
export class DocumentConflictError extends Error {
  constructor(
    readonly collection: Collection,
    readonly id: string,
  ) {
    super(`conflict writing ${collection}/${id}: the stored document changed`);
    this.name = "DocumentConflictError";
  }
}

/** Documents without their revisions, for callers that only read the catalog. */
export function documentsOf<T>(loaded: VersionedDoc<T>[] | null): T[] | null {
  return loaded ? loaded.map((entry) => entry.doc) : null;
}

/**
 * Async document persistence — the only seam between repositories and storage.
 * Implementations: browser localStorage, remote server-function bridge, PostgreSQL.
 *
 * A write is conditional on the revision it was read from. That is what stops two writers
 * holding whole-collection snapshots from replacing each other's documents: the second writer
 * gets `DocumentConflictError` and can reload and reapply its change instead of clobbering the
 * first. The revision is stored beside the document, never inside it, so domain documents stay
 * free of storage metadata.
 */
export interface DocumentStore {
  /** Returns null when the collection has never been initialised. */
  load<C extends Collection>(c: C): Promise<VersionedDoc<CollectionMap[C]>[] | null>;
  /** Initialise an empty collection with seed data. */
  seed<C extends Collection>(c: C, items: CollectionMap[C][]): Promise<void>;
  /**
   * Write a whole document.
   *
   * `expectedRev` is the revision the caller read: `null` means the caller believes the
   * document does not exist yet and wants an insert-only write; a number means update-only.
   * Returns the revision of the stored copy after the write.
   *
   * Throws `DocumentConflictError` when the document was inserted, deleted or updated by
   * another writer since that read.
   */
  put<C extends Collection>(
    c: C,
    doc: CollectionMap[C],
    expectedRev: number | null,
  ): Promise<number>;
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
