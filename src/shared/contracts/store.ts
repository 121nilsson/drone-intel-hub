import type { Candidate, Drone } from "@/entities/drone/types";
import type { MonitoredSource } from "@/entities/source/types";

export type Collection = "drones" | "candidates" | "sources";

export interface CollectionMap {
  drones: Drone;
  candidates: Candidate;
  sources: MonitoredSource;
}

export interface Snapshot {
  drones: Drone[];
  candidates: Candidate[];
  sources: MonitoredSource[];
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
}
