import type { MonitoredSource } from "@/entities/source/types";
import { ACTIVE_SEED_SOURCES, SEED_SOURCES } from "@/entities/source/seed";
import type { SourceRepository } from "@/shared/contracts/repository";
import { CachedRepository } from "./cached-repository";

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
    if (doc) this.save(doc, (fresh) => ({ ...fresh, ...patch }));
  }
  remove(id: string) {
    this.items = this.items.filter((x) => x.id !== id);
    this.drop(id);
  }
  addMissingDefaults(): number {
    const existingIds = new Set(this.items.map((s) => s.id));
    const missing = ACTIVE_SEED_SOURCES.filter((s) => !existingIds.has(s.id));
    for (const s of missing) {
      this.items = [...this.items, s];
      this.save(s);
    }
    this.emit();
    return missing.length;
  }
}
