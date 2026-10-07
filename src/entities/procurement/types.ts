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
  sourceUrl?: string;
  notes?: string;
  createdAt: string;
}
