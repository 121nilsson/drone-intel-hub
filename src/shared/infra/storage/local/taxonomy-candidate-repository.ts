import type { TaxonomyCandidate } from "@/entities/normalization/taxonomy";
import type { TaxonomyCandidateRepository, TaxonomySourceRef } from "@/shared/contracts/taxonomy";
import { CachedRepository } from "./cached-repository";

function candidateId(taxonomy: string, rawTerm: string) {
  const slug = rawTerm
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${taxonomy}/${slug || "term"}`;
}

export class LocalTaxonomyCandidateRepository
  extends CachedRepository<"taxonomy_candidates">
  implements TaxonomyCandidateRepository
{
  constructor() {
    super("taxonomy_candidates", []);
  }

  record(rawTerm: string, taxonomy: string, source: TaxonomySourceRef): TaxonomyCandidate {
    const id = candidateId(taxonomy, rawTerm);
    const now = new Date().toISOString();
    const sourceKey = source.sourceId ?? source.source;
    // Apply the observation to the freshest copy. If the source is already listed there the
    // observation is not counted twice, which is what makes this safe to replay after a conflict.
    const apply = (base: TaxonomyCandidate): TaxonomyCandidate => {
      if (base.sources.some((s) => (s.sourceId ?? s.source) === sourceKey)) return base;
      return {
        ...base,
        occurrences: base.occurrences + 1,
        lastSeen: now,
        sources: [...base.sources, { ...source, seenAt: now }],
      };
    };
    const existing = this.items.find((c) => c.id === id);
    if (existing) {
      const next = apply(existing);
      if (next === existing) return existing;
      this.items = this.items.map((c) => (c.id === id ? next : c));
      this.save(next, apply);
      return next;
    }
    const created: TaxonomyCandidate = {
      id,
      taxonomy,
      rawTerm: rawTerm.trim(),
      status: "candidate",
      occurrences: 1,
      firstSeen: now,
      lastSeen: now,
      sources: [{ ...source, seenAt: now }],
    };
    this.items = [created, ...this.items];
    this.save(created, apply);
    return created;
  }

  resolve(id: string, to: "mapped" | "promoted" | "rejected", target?: string) {
    const at = new Date().toISOString();
    const apply = (fresh: TaxonomyCandidate): TaxonomyCandidate => ({
      ...fresh,
      status: to,
      ...(target ? { resolvedCanonicalId: target } : {}),
      lastSeen: at,
    });
    this.items = this.items.map((c) => (c.id === id ? apply(c) : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc, apply);
  }

  /**
   * Revert a resolved candidate back to an unresolved one. The UI undo for reject/map cannot go
   * through resolve() because "candidate" is the absence of a decision, not one of its outcomes.
   */
  unresolve(id: string) {
    const apply = (fresh: TaxonomyCandidate): TaxonomyCandidate => {
      const next: TaxonomyCandidate = { ...fresh, status: "candidate" };
      delete next.resolvedCanonicalId;
      return next;
    };
    this.items = this.items.map((c) => (c.id === id ? apply(c) : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc, apply);
  }
}
