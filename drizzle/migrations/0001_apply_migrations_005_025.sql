-- Bring the Lovable Cloud database up to /migrations 005..025.
-- Schema only: the data repairs in 007/015/022 and the two seed rows in 008/010 are applied separately.

-- 005_normalization
create table if not exists public.taxonomies (
  id           text primary key,
  taxonomy     text not null,
  canonical_id text not null,
  label        text not null,
  parent_id    text,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);
create index if not exists taxonomies_taxonomy_idx on public.taxonomies (taxonomy, canonical_id);

create table if not exists public.taxonomy_candidates (
  id          text primary key,
  taxonomy    text not null,
  raw_term    text not null,
  status      text not null default 'candidate',
  occurrences integer not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  data        jsonb not null
);
create index if not exists taxonomy_candidates_status_idx on public.taxonomy_candidates (status, last_seen desc);
create index if not exists taxonomy_candidates_taxonomy_idx on public.taxonomy_candidates (taxonomy, raw_term);

-- 006_dispatch_content_hash
alter table public.dispatches add column if not exists content_hash text;
create index if not exists dispatches_content_hash_idx on public.dispatches (content_hash) where content_hash is not null;

-- 008_evaluation (tables; the corpus-version seed row is applied separately)
CREATE TABLE IF NOT EXISTS public.eval_reports (
  id uuid PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  seed int NOT NULL,
  sample_size int NOT NULL,
  corpus_version int NOT NULL,
  report jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.eval_corpus (
  id text NOT NULL,
  version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('positive','negative')),
  fixture jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','pending_fix','approved','rejected','superseded')),
  origin text NOT NULL CHECK (origin IN ('agreement','adjudication','pattern','analyst','git_import')),
  source_report uuid REFERENCES public.eval_reports(id),
  observed_at timestamptz NOT NULL,
  supersedes int,
  decided_at timestamptz,
  decided_by text,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS public.eval_corpus_version (
  version int PRIMARY KEY,
  created_at timestamptz NOT NULL,
  note text
);

CREATE TABLE IF NOT EXISTS public.eval_lock (
  name text PRIMARY KEY,
  held_until timestamptz NOT NULL
);

-- 009_lexicon_overrides
CREATE TABLE IF NOT EXISTS public.lexicon_overrides (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('cue','notAfter','magnitude','alias','stop')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text
);

-- 010_dynamic_rules (tables; the version seed row and the lexicon_overrides port are applied separately)
CREATE TABLE IF NOT EXISTS public.dynamic_rules (
  id             text PRIMARY KEY,
  version        int NOT NULL DEFAULT 1,
  kind           text NOT NULL CHECK (kind IN ('add_cue', 'context_filter', 'add_alias', 'add_stopword', 'add_unit_scale')),
  language       text NOT NULL DEFAULT 'all',
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'candidate'
                 CHECK (status IN ('candidate', 'evaluating', 'candidate_passed', 'shadow', 'active', 'rejected', 'quarantined', 'superseded')),
  origin         text NOT NULL CHECK (origin IN ('analyst', 'autonomous_sandbox', 'bootstrap')),
  target_key     text,
  rationale      text,
  shadow_metrics jsonb,
  trust_score    float,
  created_at     timestamptz NOT NULL DEFAULT now(),
  promoted_at    timestamptz,
  decided_by     text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.dynamic_rules_version (
  version      int PRIMARY KEY,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  note         text
);

CREATE TABLE IF NOT EXISTS public.rule_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         text REFERENCES public.dynamic_rules(id),
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  passed          boolean NOT NULL,
  corpus_size     int NOT NULL,
  regressions     int NOT NULL,
  broken_fixtures jsonb,
  f1_delta        float
);

CREATE INDEX IF NOT EXISTS idx_dynamic_rules_active ON public.dynamic_rules(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_dynamic_rules_shadow ON public.dynamic_rules(status) WHERE status = 'shadow';

-- 011_rule_sandbox
ALTER TABLE public.rule_evaluations ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE public.rule_evaluations ADD COLUMN IF NOT EXISTS rules_version int;
ALTER TABLE public.rule_evaluations ADD COLUMN IF NOT EXISTS report jsonb;
ALTER TABLE public.dynamic_rules ADD COLUMN IF NOT EXISTS evidence jsonb;
CREATE INDEX IF NOT EXISTS idx_rule_evaluations_rule ON public.rule_evaluations(rule_id, evaluated_at DESC);

-- 012_rule_decisions
CREATE TABLE IF NOT EXISTS public.rule_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     text NOT NULL REFERENCES public.dynamic_rules(id),
  category    text NOT NULL,
  origin      text NOT NULL,
  decision    text NOT NULL
              CHECK (decision IN ('shadowed', 'activated', 'auto_activated', 'rejected', 'quarantined')),
  actor       text NOT NULL CHECK (actor IN ('analyst', 'autonomous', 'circuit_breaker', 'sandbox')),
  note        text,
  decided_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rule_decisions_category ON public.rule_decisions(category);
CREATE INDEX IF NOT EXISTS idx_rule_decisions_at ON public.rule_decisions(decided_at DESC);

-- 013_shadow_metrics
ALTER TABLE public.dynamic_rules ADD COLUMN IF NOT EXISTS shadow_metrics jsonb;

-- 014_rule_status_check
ALTER TABLE public.dynamic_rules DROP CONSTRAINT IF EXISTS dynamic_rules_status_check;
ALTER TABLE public.dynamic_rules ADD CONSTRAINT dynamic_rules_status_check
  CHECK (status IN ('candidate', 'evaluating', 'candidate_passed', 'shadow', 'active', 'rejected', 'quarantined', 'superseded'));

-- 016_document_rev
alter table public.drones add column if not exists rev bigint not null default 0;
alter table public.candidates add column if not exists rev bigint not null default 0;
alter table public.sources add column if not exists rev bigint not null default 0;
alter table public.dispatches add column if not exists rev bigint not null default 0;
alter table public.procurements add column if not exists rev bigint not null default 0;
alter table public.taxonomies add column if not exists rev bigint not null default 0;
alter table public.taxonomy_candidates add column if not exists rev bigint not null default 0;

-- 017_task_runs
create table if not exists public.task_runs (
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

create index if not exists task_runs_task_started on public.task_runs (task, started_at desc);
create index if not exists task_runs_started on public.task_runs (started_at);

-- 018_autonomy_events
create table if not exists public.autonomy_events (
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
  reversed_by       text references public.autonomy_events (id),
  correlation_id    text
);

create index if not exists autonomy_events_at_idx on public.autonomy_events (at desc);
create index if not exists autonomy_events_action_at_idx on public.autonomy_events (action, at desc);
create index if not exists autonomy_events_target_idx
  on public.autonomy_events (target_collection, target_id);
create index if not exists autonomy_events_correlation_idx on public.autonomy_events (correlation_id);
create index if not exists autonomy_events_reversed_by_idx on public.autonomy_events (reversed_by);

-- 019_verification_audit
create table if not exists public.verification_audit (
  id               text primary key default gen_random_uuid()::text,
  batch_id         text not null,
  position         integer not null,
  drawn_at         timestamptz not null default now(),
  draw_seed        bigint not null,
  role             text not null check (role in ('audit', 'control', 'negative')),
  in_seed          boolean not null default false,
  drone_id         text not null,
  drone_name       text not null,
  spec_key         text not null,
  spec_label       text not null,
  claim_id         text not null,
  language         text not null,
  family           text not null,
  state_at_draw    text not null,
  verifier_version text,
  value            text not null,
  evidence         text,
  source           text not null,
  source_id        text,
  post_text        text,
  answer           text check (answer in ('yes', 'no', 'cannot_tell')),
  obviously_wrong  boolean not null default false,
  read_via         text check (read_via in ('original', 'translation')),
  answered_at      timestamptz,
  unique (batch_id, claim_id)
);

create index if not exists verification_audit_batch_idx
  on public.verification_audit (batch_id, position);
create index if not exists verification_audit_claim_idx on public.verification_audit (claim_id);
create index if not exists verification_audit_open_idx
  on public.verification_audit (drawn_at) where answer is null;

-- 020_ai_token_usage
create table if not exists public.ai_token_usage (
  day      date not null,
  purpose  text not null,
  input    bigint not null default 0,
  output   bigint not null default 0,
  calls    integer not null default 0,
  primary key (day, purpose)
);

-- 021_audit_controls (columns; the 'misread' backfill is applied separately)
alter table public.verification_audit add column if not exists control_kind text
  check (control_kind in ('altered', 'misread'));

alter table public.verification_audit add column if not exists control_disputed_at timestamptz;

-- 023_audit_second_look
alter table public.verification_audit add column if not exists second_look text
  check (second_look in ('stands', 'reader_right'));

-- 024_source_fetch_log
create table if not exists public.source_fetch_log (
  id bigserial primary key,
  source_id text not null,
  at timestamptz not null default now(),
  ok boolean not null,
  fetched integer not null default 0,
  relevant integer not null default 0,
  duplicates integer not null default 0,
  error text
);

create index if not exists source_fetch_log_source_at on public.source_fetch_log (source_id, at desc);
create index if not exists source_fetch_log_at on public.source_fetch_log (at);

-- 025_verifier_controls
create table if not exists public.verifier_controls (
  id                 text primary key default gen_random_uuid()::text,
  asked_at           timestamptz not null default now(),
  claim_id           text not null,
  drone_id           text not null,
  spec_key           text not null,
  family             text,
  language           text,
  source_id          text not null,
  true_value         text not null,
  altered_value      text not null,
  verdict            text not null check (verdict in ('supported', 'unsupported', 'uncertain')),
  span               text,
  provider           text,
  model              text,
  entailment_version text not null,
  unique (claim_id, entailment_version)
);

create index if not exists verifier_controls_asked_at_idx on public.verifier_controls (asked_at desc);

-- Dispatch lease functions (cloud baseline, drizzle/migrations/0000_migration.sql).
-- The cloud store calls these by name; without them claim() silently returns nothing.
create or replace function public.claim_dispatches(p_limit int, p_lease_ms int, p_owner text)
returns setof text language sql security definer set search_path = public as $$
  update dispatches set lease_until = now() + (p_lease_ms * interval '1 millisecond'), lease_by = p_owner
   where id in (select id from dispatches where status = 'pending' and (lease_until is null or lease_until < now())
                order by created_at asc limit p_limit for update skip locked)
  returning id;
$$;
create or replace function public.release_dispatches(p_ids text[], p_owner text)
returns void language sql security definer set search_path = public as $$
  update dispatches set lease_until = null, lease_by = null where id = any(p_ids) and lease_by = p_owner;
$$;

revoke all on function public.claim_dispatches(int,int,text) from public, anon, authenticated;
revoke all on function public.release_dispatches(text[],text) from public, anon, authenticated;
grant execute on function public.claim_dispatches(int,int,text) to service_role;
grant execute on function public.release_dispatches(text[],text) to service_role;

-- Data API access for every new table (Supabase grants no default privileges on public).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.taxonomies, public.taxonomy_candidates,
  public.eval_reports, public.eval_corpus, public.eval_corpus_version, public.eval_lock,
  public.lexicon_overrides,
  public.dynamic_rules, public.dynamic_rules_version, public.rule_evaluations, public.rule_decisions,
  public.task_runs, public.autonomy_events, public.verification_audit, public.ai_token_usage,
  public.source_fetch_log, public.verifier_controls
TO authenticated;

GRANT ALL ON
  public.taxonomies, public.taxonomy_candidates,
  public.eval_reports, public.eval_corpus, public.eval_corpus_version, public.eval_lock,
  public.lexicon_overrides,
  public.dynamic_rules, public.dynamic_rules_version, public.rule_evaluations, public.rule_decisions,
  public.task_runs, public.autonomy_events, public.verification_audit, public.ai_token_usage,
  public.source_fetch_log, public.verifier_controls
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.task_runs_id_seq, public.source_fetch_log_id_seq
TO authenticated, service_role;

-- Same protection as the tables that were already there.
alter table public.taxonomies enable row level security;
alter table public.taxonomy_candidates enable row level security;
alter table public.eval_reports enable row level security;
alter table public.eval_corpus enable row level security;
alter table public.eval_corpus_version enable row level security;
alter table public.eval_lock enable row level security;
alter table public.lexicon_overrides enable row level security;
alter table public.dynamic_rules enable row level security;
alter table public.dynamic_rules_version enable row level security;
alter table public.rule_evaluations enable row level security;
alter table public.rule_decisions enable row level security;
alter table public.task_runs enable row level security;
alter table public.autonomy_events enable row level security;
alter table public.verification_audit enable row level security;
alter table public.ai_token_usage enable row level security;
alter table public.source_fetch_log enable row level security;
alter table public.verifier_controls enable row level security;