-- Scheduler bookkeeping. Keeps the auto-sync throttle across restarts so a
-- cron tick can check "when did we last sync?" without trusting process memory.

create table if not exists sync_state (
  name        text primary key,
  last_sync   timestamptz not null,
  last_result jsonb
);

-- Claiming a sync slot is a single atomic upsert: the WHERE clause on the
-- conflict branch means concurrent callers cannot both win the same slot.
--   insert into sync_state (name, last_sync) values ($1, now())
--   on conflict (name) do update set last_sync = excluded.last_sync
--   where sync_state.last_sync <= now() - $2::interval
--   returning last_sync;
-- Zero rows returned means the minimum interval has not elapsed yet.