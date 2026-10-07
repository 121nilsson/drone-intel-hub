import type { MonitoredSource } from "@/entities/source/types";
import type { Candidate, Domain, Drone } from "@/entities/drone/types";

export interface CatalogFacets {
  domains?: Domain[];
  origin?: string[];
  operators?: string[];
  bands?: string[];
  propulsion?: string[];
}

/** Persistence contract — swap localStorage for any DB without touching features. */
export interface DroneRepository {
  list(): Drone[];
  get(id: string): Drone | undefined;
  upsert(drone: Drone): void;
  search(query: string, facets?: CatalogFacets): Drone[];
}

export interface CandidateRepository {
  list(): Candidate[];
  add(c: Candidate): void;
  update(id: string, patch: Partial<Candidate>): void;
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
