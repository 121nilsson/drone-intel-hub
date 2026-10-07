import type { Candidate, Drone } from "@/entities/drone/types";
import { SEED_DRONES } from "@/entities/drone/seed";
import type { MonitoredSource } from "@/entities/source/types";
import { SEED_SOURCES } from "@/entities/source/seed";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Procurement } from "@/entities/procurement/types";
import type {
  DispatchRepository,
  SourceRepository,
  CandidateRepository,
  CatalogFacets,
  DroneRepository,
  Subscribable,
} from "@/shared/contracts/repository";
import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";

const norm = (s: string) => s.toLowerCase().normalize("NFKD");

export function droneHaystack(d: Drone) {
  return norm(
    [
      d.name,
      d.cyrillic ?? "",
      ...d.aliases,
      d.manufacturer ?? "",
      ...d.components.map((c) => `${c.manufacturer} ${c.part}`),
    ].join(" | "),
  );
}

/**
 * Write-through cache: synchronous reads for the UI, async persistence to any DocumentStore.
 * Swapping storage = attaching a different store; features never change.
 */
abstract class CachedRepository<C extends Collection> implements Subscribable {
  private fns = new Set<() => void>();
  protected store: DocumentStore | null = null;
  constructor(
    protected collection: C,
    protected items: CollectionMap[C][],
  ) {}
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
  protected emit() {
    this.fns.forEach((f) => f());
  }

  async attach(store: DocumentStore) {
    this.store = store;
    const loaded = await store.load(this.collection);
    if (loaded === null) await store.seed(this.collection, this.items);
    else {
      this.items = loaded;
      this.emit();
    }
  }
  protected save(doc: CollectionMap[C]) {
    this.emit();
    this.store
      ?.put(this.collection, doc)
      .catch((e) => console.error(`[store] put ${this.collection}`, e));
  }
  protected drop(id: string) {
    this.emit();
    this.store
      ?.remove(this.collection, id)
      .catch((e) => console.error(`[store] remove ${this.collection}`, e));
  }
  list() {
    return this.items;
  }
}

export class LocalDroneRepository extends CachedRepository<"drones"> implements DroneRepository {
  constructor() {
    super("drones", SEED_DRONES);
  }
  get(id: string) {
    return this.items.find((d) => d.id === id);
  }
  upsert(drone: Drone) {
    const i = this.items.findIndex((d) => d.id === drone.id);
    this.items =
      i >= 0 ? this.items.map((d) => (d.id === drone.id ? drone : d)) : [...this.items, drone];
    this.save(drone);
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

export class LocalCandidateRepository
  extends CachedRepository<"candidates">
  implements CandidateRepository
{
  constructor() {
    super("candidates", []);
  }
  add(c: Candidate) {
    this.items = [c, ...this.items];
    this.save(c);
  }
  update(id: string, patch: Partial<Candidate>) {
    this.items = this.items.map((c) => (c.id === id ? { ...c, ...patch } : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc);
  }
}

export class LocalSourceRepository extends CachedRepository<"sources"> implements SourceRepository {
  constructor() {
    super("sources", SEED_SOURCES);
  }
  add(s: MonitoredSource) {
    this.items = [s, ...this.items];
    this.save(s);
  }
  update(id: string, patch: Partial<MonitoredSource>) {
    this.items = this.items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    const doc = this.items.find((x) => x.id === id);
    if (doc) this.save(doc);
  }
  remove(id: string) {
    this.items = this.items.filter((x) => x.id !== id);
    this.drop(id);
  }
  addMissingDefaults(): number {
    const existingIds = new Set(this.items.map((s) => s.id));
    const missing = SEED_SOURCES.filter((s) => !existingIds.has(s.id));
    for (const s of missing) {
      this.items = [...this.items, s];
      this.save(s);
    }
    this.emit();
    return missing.length;
  }
}

export class LocalDispatchRepository
  extends CachedRepository<"dispatches">
  implements DispatchRepository
{
  constructor() {
    super("dispatches", []);
  }
  has(id: string) {
    return this.items.some((d) => d.id === id);
  }
  add(d: RawDispatch) {
    if (this.has(d.id)) return false;
    this.items = [d, ...this.items];
    this.save(d);
    return true;
  }
  update(id: string, patch: Partial<RawDispatch>) {
    this.items = this.items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    const doc = this.items.find((x) => x.id === id);
    if (doc) this.save(doc);
  }
  pending(limit: number) {
    return this.items
      .filter((d) => d.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }
  /**
   * Delegates the exclusive claim to storage. The lease deliberately lives in the store, not
   * in this cache: the cache is a per-tab snapshot and cannot make claiming exclusive.
   */
  async claim(limit: number, leaseMs: number, owner: string) {
    if (!this.store?.claim) return null;
    const ids = await this.store.claim("dispatches", { limit, leaseMs, owner });
    if (ids === null) return null;
    // Re-read so the claimed documents come back with the values just written by any other
    // worker, rather than from a cache that may predate their change.
    await this.attach(this.store);
    return ids;
  }
  async release(ids: string[], owner: string) {
    await this.store?.release?.("dispatches", ids, owner);
  }
}

export class LocalProcurementRepository extends CachedRepository<"procurements"> {
  constructor() {
    super("procurements", []);
  }
  add(p: Procurement) {
    this.items = [p, ...this.items];
    this.save(p);
  }
}
