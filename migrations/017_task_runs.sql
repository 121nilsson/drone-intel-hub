-- One row per run of a background job (scheduled by Nitro or started from a button), so the UI
-- can show when each job last ran, how long it took and whether it failed.
--
-- Idempotent because adopting a database re-runs every migration once (see migrate.server.ts).

create table if not exists task_runs (
  id bigserial primary key,
  task text not null,
  trigger text not null default 'schedule',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  status text not null default 'running',
  summary text,
  error text
);

create index if not exists task_runs_task_started on task_runs (task, started_at desc);
create index if not exists task_runs_started on task_runs (started_at);
