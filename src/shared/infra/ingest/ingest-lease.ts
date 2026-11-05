/**
 * Lease duration is derived from the batch size, not fixed. A lease must outlive the run that
 * took it: if it expires while the batch is still working, another worker can re-claim a
 * document this run is still processing - reintroducing exactly the double-processing the
 * lease exists to prevent. The real constraint is therefore batch duration, which scales with
 * `limit` (roughly two model calls per document, several seconds each).
 *
 * So the budget is per document, and short interactive runs keep a short lease - meaning fast
 * recovery if a worker dies - while a large cron batch gets proportionally longer cover.
 */
const LEASE_PER_ITEM_MS = 15_000;
const MIN_LEASE_MS = 5 * 60_000;
export const MAX_LEASE_MS = 60 * 60_000;

/** Long enough to cover the whole batch. See LEASE_PER_ITEM_MS. */
export const leaseFor = (limit: number) =>
  Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, limit * LEASE_PER_ITEM_MS));
