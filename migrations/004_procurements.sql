-- Procurement contracts, grants, and production deals.
-- Captured from posts like "Company X has been granted Y amount to produce drones for Z".

create table if not exists procurements (
  id            text primary key,
  company       text not null,
  country       text not null default '',
  amount        text,
  currency      text,
  program       text,
  product       text,
  customer      text,
  announced_at  timestamptz,
  source        text not null,
  source_url    text,
  notes         text,
  created_at    timestamptz not null default now(),
  data          jsonb not null
);
create index if not exists procurements_company_idx on procurements (company);
create index if not exists procurements_country_idx on procurements (country);
create index if not exists procurements_created_at_idx on procurements (created_at desc);
