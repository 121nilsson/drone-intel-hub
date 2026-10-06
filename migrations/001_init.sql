-- DRONE//INT core schema. Plain PostgreSQL (>= 13), no vendor extensions.
-- Documents are stored as JSONB (schema-less specs); hot fields are mirrored into columns for indexing.

create table if not exists collection_meta (
  name        text primary key,
  seeded_at   timestamptz not null default now()
);

create table if not exists drones (
  id          text primary key,
  name        text not null,
  domain      text not null,
  origin      text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists drones_domain_idx on drones (domain);
create index if not exists drones_data_gin on drones using gin (data jsonb_path_ops);

create table if not exists candidates (
  id          text primary key,
  status      text not null,
  tier        smallint not null,
  created_at  timestamptz not null,
  data        jsonb not null
);
create index if not exists candidates_status_idx on candidates (status, created_at desc);

create table if not exists sources (
  id          text primary key,
  position    bigserial,
  platform    text not null,
  handle      text not null,
  data        jsonb not null
);
