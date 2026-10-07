-- Per-dispatch processing lease. processPending() is called from the browser ("Analyse
-- queue") and from the cron task, and both read the same pending set before either writes
-- status - so two workers could process one dispatch and produce duplicate candidates and
-- duplicate merges. A lease makes claiming a dispatch atomic and exclusive.
--
-- The lease lives in real columns rather than inside the jsonb `data` blob so the claim can
-- be a single indexed UPDATE, and so a browser write of a stale cached document cannot
-- clobber another worker's lease.
--
-- lease_until is an expiry, not a lock: a worker that crashes mid-processing leaves the row
-- leased, and the lease simply becomes claimable again once it passes. No cleanup job needed.

alter table dispatches add column if not exists lease_until timestamptz;
alter table dispatches add column if not exists lease_by text;

-- Supports the claim query: pending rows, oldest first, skipping actively leased ones.
create index if not exists dispatches_claim_idx
  on dispatches (created_at asc) where status = 'pending';
