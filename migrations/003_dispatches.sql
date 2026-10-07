-- Raw dispatch archive + processing queue. Collectors insert rows as 'pending';
-- the processor drains them in small batches and records provenance links.
-- Irrelevant posts keep only a stub (empty text) so they are never re-fetched.

create table if not exists dispatches (
  id            text primary key,           -- "<source_id>|<external_id>"
  source_id     text not null,
  status        text not null default 'pending', -- pending | processed | irrelevant | failed
  created_at    timestamptz not null default now(),
  processed_at  timestamptz,
  data          jsonb not null
);
create index if not exists dispatches_status_idx on dispatches (status, created_at asc);
create index if not exists dispatches_source_idx on dispatches (source_id, created_at desc);
create index if not exists dispatches_data_gin on dispatches using gin (data jsonb_path_ops);
