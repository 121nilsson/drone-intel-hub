import {
  SEEDED_TERMS,
  storedTerm,
  type StoredTaxonomyTerm,
} from "@/entities/normalization/taxonomy";
import type { TaxonomyRepository } from "@/shared/contracts/taxonomy";
import type { DocumentStore } from "@/shared/contracts/store";
import { CachedRepository } from "./cached-repository";

export class LocalTaxonomyRepository
  extends CachedRepository<"taxonomies">
  implements TaxonomyRepository
{
  constructor() {
    super(
      "taxonomies",
      SEEDED_TERMS.map((t) => storedTerm(t)),
    );
  }

  /** Stored edits replace the seed with the same id. Seeds missing from the store stay available. */
  override async attach(store: DocumentStore) {
    // Same rule as the base repository: a failed load or seed leaves the old store in place.
    const loaded = await store.load(this.collection);
    if (loaded === null) {
      await store.seed(this.collection, this.items);
      this.store = store;
      this.revs = new Map(this.items.map((t) => [t.id, 0]));
      return;
    }
    const byId = new Map(this.items.map((t) => [t.id, t]));
    // Seed-only terms are deliberately absent from `revs`: they do not exist in the store
    // yet, so their first write must be an insert rather than a conditional update.
    const revs = new Map<string, number>();
    for (const entry of loaded) {
      byId.set(entry.doc.id, entry.doc);
      revs.set(entry.doc.id, entry.rev);
    }
    this.items = [...byId.values()];
    this.revs = revs;
    this.store = store;
    this.emit();
  }

  terms(taxonomy?: string) {
    return taxonomy ? this.items.filter((t) => t.taxonomy === taxonomy) : this.items;
  }

  upsertTerm(term: StoredTaxonomyTerm) {
    const i = this.items.findIndex((t) => t.id === term.id);
    this.items =
      i >= 0 ? this.items.map((t) => (t.id === term.id ? term : t)) : [...this.items, term];
    this.save(term);
  }
}
