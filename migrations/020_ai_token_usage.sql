-- The daily token ceiling for verification and its judges (get_human_out_of_the_loop_plan.md §14:
-- 0.5M output and 5M input tokens a day). One row per UTC day and purpose, added to after every
-- call, read before every call: the ceiling is enforced, not estimated after the fact.
--
-- Additive and idempotent by convention (adopting a database re-runs every migration once - see
-- migrate.server.ts).

create table if not exists ai_token_usage (
  day      date not null,
  purpose  text not null,
  input    bigint not null default 0,
  output   bigint not null default 0,
  calls    integer not null default 0,
  primary key (day, purpose)
);
