import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";

const KEYS: Record<Collection, string> = {
  drones: "dti.drones.v1",
  candidates: "dti.candidates.v1",
  sources: "dti.sources.v1",
};

/** Browser-only store: one JSON array per collection in localStorage. */
export class LocalStorageStore implements DocumentStore {
  private read<C extends Collection>(c: C): CollectionMap[C][] | null {
    try { const raw = localStorage.getItem(KEYS[c]); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  private write(c: Collection, items: unknown[]) {
    try { localStorage.setItem(KEYS[c], JSON.stringify(items)); } catch { /* quota */ }
  }
  async load<C extends Collection>(c: C) { return this.read(c); }
  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) { this.write(c, items); }
  async put<C extends Collection>(c: C, doc: CollectionMap[C]) {
    const items = (this.read(c) ?? []) as { id: string }[];
    const i = items.findIndex((x) => x.id === doc.id);
    this.write(c, i >= 0 ? items.map((x) => (x.id === doc.id ? doc : x)) : [doc, ...items]);
  }
  async remove(c: Collection, id: string) {
    this.write(c, ((this.read(c) ?? []) as { id: string }[]).filter((x) => x.id !== id));
  }
}
