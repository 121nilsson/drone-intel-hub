/**
 * A procurement contract, grant, or production deal.
 * Captured from posts like "Company X has been granted Y amount to produce drones for Z".
 */
export interface Procurement {
  id: string;
  company: string;
  country: string; // ISO2 country code of the company
  amount?: string; // e.g. "$50M", "€120M", "₽5B"
  currency?: string;
  program?: string; // e.g. "Brave1", "State Defense Order"
  product?: string; // what is being produced, e.g. "FPV drones", "interceptor UAVs"
  customer?: string; // who is buying, e.g. "Ukrainian MoD", "Russian MoD"
  announcedAt?: string; // ISO date
  source: string; // where this was reported
  sourceId?: string; // RawDispatch id when this came from ingestion
  sourceUrl?: string;
  /**
   * Catalog entries the contract names, when the extraction resolved them. Kept apart from
   * `product`, which stays the report's own wording, so the UI can link only what was matched.
   */
  systemIds?: string[];
  systemNames?: string[];
  notes?: string;
  /**
   * Content identity for a contract, used to ignore the same deal when a post is analysed
   * again. A random document id cannot do that.
   */
  dedupeKey?: string;
  createdAt: string;
}
