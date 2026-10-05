import type { Candidate, Drone } from "@/entities/drone/types";
import { SEED_DRONES } from "@/entities/drone/seed";
import type { CandidateRepository, CatalogFacets, DroneRepository, Subscribable } from "@/shared/contracts/repository";

const norm = (s: string) => s.toLowerCase().normalize("NFKD");

export function droneHaystack(d: Drone) {
  return norm([d.name, d.cyrillic ?? "", ...d.aliases, ...d.components.map((c) => `${c.manufacturer} ${c.part}`)].join(" | "));
}

class Emitter implements Subscribable {
  private fns = new Set<() => void>();
  subscribe(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  protected emit() { this.fns.forEach((f) => f()); }
}

export class LocalDroneRepository extends Emitter implements DroneRepository {
  private items: Drone[] = SEED_DRONES;
  constructor(private key = "dti.drones.v1") { super(); }
  hydrate() {
    try { const raw = localStorage.getItem(this.key); if (raw) { this.items = JSON.parse(raw); this.emit(); } } catch { /* ignore */ }
  }
  private persist() { try { localStorage.setItem(this.key, JSON.stringify(this.items)); } catch { /* ignore */ } this.emit(); }
  list() { return this.items; }
  get(id: string) { return this.items.find((d) => d.id === id); }
  upsert(drone: Drone) {
    const i = this.items.findIndex((d) => d.id === drone.id);
    this.items = i >= 0 ? this.items.map((d) => (d.id === drone.id ? drone : d)) : [...this.items, drone];
    this.persist();
  }
  search(query: string, f: CatalogFacets = {}) {
    const q = norm(query.trim());
    return this.items.filter((d) => {
      if (q && !droneHaystack(d).includes(q)) return false;
      if (f.domains?.length && !f.domains.includes(d.domain)) return false;
      if (f.origin?.length && !f.origin.includes(d.origin)) return false;
      if (f.operators?.length && !d.operators.some((o) => f.operators!.includes(o))) return false;
      if (f.bands?.length && !d.rf.some((r) => f.bands!.includes(r.band))) return false;
      if (f.propulsion?.length && !f.propulsion.includes(d.propulsion)) return false;
      return true;
    });
  }
}

export class LocalCandidateRepository extends Emitter implements CandidateRepository {
  private items: Candidate[] = [];
  constructor(private key = "dti.candidates.v1") { super(); }
  hydrate() {
    try { const raw = localStorage.getItem(this.key); if (raw) { this.items = JSON.parse(raw); this.emit(); } } catch { /* ignore */ }
  }
  private persist() { try { localStorage.setItem(this.key, JSON.stringify(this.items)); } catch { /* ignore */ } this.emit(); }
  list() { return this.items; }
  add(c: Candidate) { this.items = [c, ...this.items]; this.persist(); }
  update(id: string, patch: Partial<Candidate>) { this.items = this.items.map((c) => (c.id === id ? { ...c, ...patch } : c)); this.persist(); }
}
