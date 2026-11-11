-- One row per fetch of a monitored source, so health can be read over time: how often a source
-- fails, how much it yields, and when it last produced anything. Kept 90 days (pruned once per sync).
--
-- Idempotent because adopting a database re-runs every migration once (see migrate.server.ts).

create table if not exists source_fetch_log (
  id bigserial primary key,
  source_id text not null,
  at timestamptz not null default now(),
  ok boolean not null,
  fetched integer not null default 0,
  relevant integer not null default 0,
  duplicates integer not null default 0,
  error text
);

create index if not exists source_fetch_log_source_at on source_fetch_log (source_id, at desc);
-- The write path prunes by age across every source, which the index above cannot serve.
create index if not exists source_fetch_log_at on source_fetch_log (at);
