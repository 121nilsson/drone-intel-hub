-- Phase 0/1 of the autonomy plan: one ledger for every decision an autonomous step took (or
-- deliberately withheld) - a verification run, a rejected claim, an applied correction.
--
-- The catalogue already records the *state* each claim ended in; this records the *decision* that
-- put it there: who made it, on what, what it was before and after, and whether it was reversed.
-- Decisions are kept forever, because `reversed_by` points into that history; only heartbeat
-- kinds (a run that changed nothing by itself) are pruned, by the writer, by an explicit list.
--
-- Additive and idempotent by convention (adopting a database re-runs every migration once - see
-- migrate.server.ts).

create table if not exists autonomy_events (
  id                text primary key default gen_random_uuid()::text,
  at                timestamptz not null default now(),
  action            text not null,
  actor             text not null,
  actor_kind        text not null check (actor_kind in
                      ('heuristic', 'ai', 'verifier', 'rule', 'audit', 'analyst', 'system')),
  target_collection text not null,
  target_id         text not null,
  category          text,
  verdict           text,
  before            jsonb,
  after             jsonb,
  reason            text,
  checks            jsonb,
  confidence        double precision,
  reversible        boolean not null default true,
  reversed_by       text references autonomy_events (id),
  correlation_id    text
);

create index if not exists autonomy_events_at_idx on autonomy_events (at desc);
create index if not exists autonomy_events_action_at_idx on autonomy_events (action, at desc);
create index if not exists autonomy_events_target_idx
  on autonomy_events (target_collection, target_id);
create index if not exists autonomy_events_correlation_idx on autonomy_events (correlation_id);
-- The heartbeat prune checks that no event points back at a row; decisions are never pruned, so
-- without this that check would scan an ever-growing table on every run.
create index if not exists autonomy_events_reversed_by_idx on autonomy_events (reversed_by);
