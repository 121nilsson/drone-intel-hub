import type { Procurement } from "@/entities/procurement/types";
import { procurementDedupeKey } from "@/entities/procurement/routing";
import { CachedRepository } from "./cached-repository";

export class LocalProcurementRepository extends CachedRepository<"procurements"> {
  constructor() {
    super("procurements", []);
  }
  /**
   * Idempotent by content: a post re-analysed after a heuristic or model change produces a new
   * document id, so `p.id` cannot prevent a duplicate row. The source claim and figure can.
   */
  add(p: Procurement) {
    const key = p.dedupeKey ?? procurementDedupeKey(p);
    if (
      this.items.some((existing) => (existing.dedupeKey ?? procurementDedupeKey(existing)) === key)
    )
      return;
    this.items = [p, ...this.items];
    this.save(p);
  }
  update(p: Procurement, replay?: (fresh: Procurement) => Procurement) {
    if (!this.items.some((x) => x.id === p.id)) return;
    this.items = this.items.map((x) => (x.id === p.id ? p : x));
    this.save(p, replay);
  }
}
