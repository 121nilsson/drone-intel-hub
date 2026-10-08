import type { StoredTaxonomyTerm, TaxonomyCandidate } from "@/entities/normalization/taxonomy";

export interface TaxonomySourceRef {
  source: string;
  sourceId?: string;
  droneId?: string;
}

export interface TaxonomyRepository {
  terms(taxonomy?: string): StoredTaxonomyTerm[];
  upsertTerm(term: StoredTaxonomyTerm): void;
}

export interface TaxonomyCandidateRepository {
  list(): TaxonomyCandidate[];
  record(rawTerm: string, taxonomy: string, source: TaxonomySourceRef): TaxonomyCandidate;
  resolve(id: string, to: "mapped" | "promoted" | "rejected", target?: string): void;
}
