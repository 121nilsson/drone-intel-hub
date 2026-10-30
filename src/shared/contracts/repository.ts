import type { MonitoredSource } from "@/entities/source/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Candidate, Domain, Drone } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";

/** Contract, grant and production-deal records, kept apart from drone specs. */
export interface ProcurementRepository {
  list(): Procurement[];
  add(p: Procurement): void;
  /** Replace a stored record; `replay` reapplies the edit to the stored copy on a conflict. */
  update(p: Procurement, replay?: (fresh: Procurement) => Procurement): void;
}

export interface CatalogFacets {
  domains?: Domain[];
  origin?: string[];
  operators?: string[];
  bands?: string[];
  propulsion?: string[];
  ieeeBands?: string[];
  natoBands?: string[];
  propulsionIds?: string[];
  installationIds?: string[];
  protocols?: string[];
  fiberOnly?: boolean;
}

/** Persistence contract — swap localStorage for any DB without touching features. */
export interface DroneRepository {
  list(): Drone[];
  get(id: string): Drone | undefined;
  /**
   * Apply a whole-document edit. `replay` receives the stored copy when another writer wins
   * the race and must return the same edit applied to that copy; without it a conflict reloads
   * rather than overwriting the other writer.
   */
  upsert(drone: Drone, replay?: (fresh: Drone) => Drone): void;
  remove(id: string): void;
  search(query: string, facets?: CatalogFacets): Drone[];
  /** Add seed entries the catalog lacks (the catalog page's "Load missing"); retired ids are excluded. */
  addMissingDefaults?(): number;
}

export interface CandidateRepository {
  list(): Candidate[];
  add(c: Candidate): void;
  update(id: string, patch: Partial<Candidate>): void;
  remove(id: string): void;
}

export interface Subscribable {
  subscribe(fn: () => void): () => void;
}

export interface SourceRepository {
  list(): MonitoredSource[];
  add(s: MonitoredSource): void;
  update(id: string, patch: Partial<MonitoredSource>): void;
  remove(id: string): void;
  addMissingDefaults?(): number;
}

/** Raw dispatch archive + processing queue. */
export interface DispatchRepository {
  list(): RawDispatch[];
  has(id: string): boolean;
  /** Returns false when the dispatch already exists (dedupe). */
  add(d: RawDispatch): boolean;
  update(id: string, patch: Partial<RawDispatch>): void;
  /** Oldest pending first. */
  pending(limit: number): RawDispatch[];
  /**
   * Lease up to `limit` pending dispatches for exclusive processing. Returns null when the
   * backing store cannot lease, so callers can fall back to `pending()`. See DocumentStore.claim.
   */
  claim?(limit: number, leaseMs: number, owner: string): Promise<string[] | null>;
  /** Release leases held by `owner`. */
  release?(ids: string[], owner: string): Promise<void>;
  /**
   * Id of the already-stored dispatch this fingerprint duplicates, or null. Suppresses the
   * copies of one story that reach the pipeline from several sources at once: they cost an
   * extraction each and would each be recorded as a separate claim source in consensus().
   *
   * Optional, so a store or test double without dedupe support simply never suppresses one.
   */
  duplicateOf?(fingerprint: string): string | null;
  /**
   * Id of the already-stored dispatch carrying this exact article URL, or null.
   *
   * The deterministic companion to `duplicateOf`. A site-wide feed and its category feed, or an
   * index page and the article's permalink, republish one article under different `sourceId`s, so
   * the `${sourceId}|${externalId}` key does not collide and both copies are analysed. Text
   * similarity catches that only when the copies happen to read alike - and a feed serving a
   * teaser next to one serving the full body guarantees they do not. URL identity is exact.
   *
   * Optional, like `duplicateOf`, so a store or test double without it simply never suppresses one.
   * Implementations must ignore the document being added (pass its id as `excludeId`), since the
   * caller has usually already inserted it, and must resolve a duplicate stub to its canonical post.
   */
  duplicateOfUrl?(url: string | undefined, excludeId?: string): string | null;
}
