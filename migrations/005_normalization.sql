-- Canonical taxonomy terms and the queue of terms ingestion could not classify.
-- Same layout as the other collections: a JSONB document plus the columns the stores filter on.

create table if not exists taxonomies (
  id           text primary key,
  taxonomy     text not null,
  canonical_id text not null,
  label        text not null,
  parent_id    text,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);
create index if not exists taxonomies_taxonomy_idx on taxonomies (taxonomy, canonical_id);

create table if not exists taxonomy_candidates (
  id          text primary key,
  taxonomy    text not null,
  raw_term    text not null,
  status      text not null default 'candidate',
  occurrences integer not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  data        jsonb not null
);
create index if not exists taxonomy_candidates_status_idx on taxonomy_candidates (status, last_seen desc);
create index if not exists taxonomy_candidates_taxonomy_idx on taxonomy_candidates (taxonomy, raw_term);
